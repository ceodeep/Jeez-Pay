const express = require("express");
const path = require("path");

const router = express.Router();
const supabase = require("../config/supabase");
const supabaseAdmin = require("../config/supabaseAdmin");
const authMiddleware = require("../middlewares/auth.middleware");

const KYC_BUCKET = "kyc-documents";
const IDENTITY_CONTENT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const SUPPORTING_CONTENT_TYPES = new Set([...IDENTITY_CONTENT_TYPES, "application/pdf"]);
const FILE_TYPES = new Set(["id_front", "id_back", "selfie", "proof_of_address", "supporting_document"]);

function normalize(value) {
  return String(value ?? "").trim();
}

function safeClientIp(req) {
  return normalize(req.ip || req.headers["x-forwarded-for"] || "").slice(0, 200) || null;
}

function mapSubmitError(error) {
  const message = String(error?.message || "");
  if (message.includes("KYC_V3_USER_NOT_ELIGIBLE")) return [403, "Account is not eligible for identity verification"];
  if (message.includes("KYC_V3_PROHIBITED_JURISDICTION")) return [403, "Identity verification is not available for this jurisdiction"];
  if (message.includes("KYC_V3_DOCUMENT_EXPIRED")) return [400, "Identity document is expired"];
  if (message.includes("KYC_V3_SOURCE_OF_WEALTH_REQUIRED")) return [400, "Source of wealth is required for enhanced due diligence"];
  if (message.includes("KYC_V3_REQUIRED_CONSENT_MISSING")) return [400, "Required verification consents were not accepted"];
  if (message.includes("KYC_V3_")) return [400, "Invalid identity verification submission"];
  return [500, "Identity verification could not be submitted"];
}

async function getActivePolicy() {
  const { data, error } = await supabase.rpc("kyc_active_policy_v3");
  if (error || !data) throw error || new Error("KYC policy unavailable");
  return data;
}

async function storageObject(userId, objectPath) {
  const raw = normalize(objectPath);
  const prefix = `${userId}/`;
  if (!raw.startsWith(prefix) || raw.includes("..") || /^https?:\/\//i.test(raw)) return null;

  const filename = path.posix.basename(raw);
  const dir = path.posix.dirname(raw);
  if (dir !== String(userId) || !filename) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(KYC_BUCKET)
    .list(String(userId), { limit: 100, search: filename });

  if (error) throw error;
  return (data || []).find((item) => item.name === filename) || null;
}

async function assertEvidence(userId, objectPath, maxBytes, allowedTypes) {
  const object = await storageObject(userId, objectPath);
  if (!object) {
    const err = new Error("KYC_EVIDENCE_OBJECT_MISSING");
    err.status = 400;
    throw err;
  }

  const size = Number(object?.metadata?.size ?? 0);
  if (Number.isFinite(size) && size > Number(maxBytes || 0)) {
    const err = new Error("KYC_EVIDENCE_TOO_LARGE");
    err.status = 413;
    throw err;
  }

  const mime = normalize(object?.metadata?.mimetype || object?.metadata?.contentType).toLowerCase();
  if (mime && !allowedTypes.has(mime)) {
    const err = new Error("KYC_EVIDENCE_CONTENT_TYPE_INVALID");
    err.status = 400;
    throw err;
  }
  return object;
}

router.get("/policy", async (_req, res) => {
  try {
    return res.json(await getActivePolicy());
  } catch (error) {
    console.error("[kyc-v3] policy error:", error);
    return res.status(503).json({ message: "Identity verification policy is unavailable" });
  }
});

router.post("/upload-url", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const fileType = normalize(req.body?.fileType).toLowerCase();
    const contentType = normalize(req.body?.contentType).toLowerCase();
    const schemaVersion = Number(req.body?.schemaVersion || 0);
    const policy = await getActivePolicy();

    if (schemaVersion !== Number(policy.schemaVersion)) {
      return res.status(409).json({ code: "KYC_SCHEMA_OUTDATED", message: "Please update the app before continuing identity verification" });
    }
    if (!FILE_TYPES.has(fileType)) return res.status(400).json({ message: "Invalid KYC file type" });

    const allowed = fileType === "proof_of_address" || fileType === "supporting_document"
      ? SUPPORTING_CONTENT_TYPES
      : IDENTITY_CONTENT_TYPES;
    if (!allowed.has(contentType)) return res.status(400).json({ message: "Unsupported KYC file format" });

    const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
    const objectPath = `${userId}/${fileType}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const { data, error } = await supabaseAdmin.storage.from(KYC_BUCKET).createSignedUploadUrl(objectPath);
    if (error || !data?.signedUrl) {
      console.error("[kyc-v3] signed upload error:", error);
      return res.status(500).json({ message: "Failed to prepare secure KYC upload" });
    }

    return res.json({
      path: objectPath,
      signedUrl: data.signedUrl,
      expiresAt: null,
      maxBytes: Number(policy.maxUploadBytes),
      schemaVersion: Number(policy.schemaVersion),
    });
  } catch (error) {
    console.error("[kyc-v3] upload-url crash:", error);
    return res.status(500).json({ message: "Failed to prepare secure KYC upload" });
  }
});

router.post("/submit", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const payload = req.body || {};
    const policy = await getActivePolicy();

    if (Number(payload.schemaVersion || 0) !== Number(policy.schemaVersion)) {
      return res.status(409).json({ code: "KYC_SCHEMA_OUTDATED", message: "Please update the app before continuing identity verification" });
    }

    const document = payload.document || {};
    const frontPath = normalize(document.frontPath);
    const backPath = normalize(document.backPath);
    const selfiePath = normalize(document.selfiePath);
    if (!frontPath || !selfiePath) return res.status(400).json({ message: "Document front and selfie are required" });

    await assertEvidence(userId, frontPath, policy.maxUploadBytes, IDENTITY_CONTENT_TYPES);
    await assertEvidence(userId, selfiePath, policy.maxUploadBytes, IDENTITY_CONTENT_TYPES);
    if (backPath) await assertEvidence(userId, backPath, policy.maxUploadBytes, IDENTITY_CONTENT_TYPES);

    const { data, error } = await supabase.rpc("submit_kyc_v3", {
      p_user_id: userId,
      p_payload: payload,
      p_client_ip: safeClientIp(req),
      p_user_agent: normalize(req.headers["user-agent"]).slice(0, 1000) || null,
    });
    if (error) {
      console.error("[kyc-v3] submit RPC error:", { message: error.message, code: error.code });
      const [status, message] = mapSubmitError(error);
      return res.status(status).json({ message });
    }
    if (data?.ok !== true) {
      const status = ["KYC_ALREADY_APPROVED", "KYC_ALREADY_PENDING"].includes(data?.code) ? 409 : 400;
      return res.status(status).json({ code: data?.code || "KYC_SUBMISSION_REJECTED", message: data?.message || "KYC submission rejected", status: data?.status || null });
    }

    return res.json({
      message: data.event === "resubmitted" ? "KYC resubmitted" : "KYC submitted",
      kyc: {
        applicationId: data.applicationId,
        applicationVersion: data.applicationVersion,
        schemaVersion: data.schemaVersion,
        policyVersion: data.policyVersion,
        workflowStatus: data.workflowStatus,
        status: data.status,
        riskRating: data.riskRating,
      },
    });
  } catch (error) {
    console.error("[kyc-v3] submit crash:", error);
    return res.status(Number(error?.status) || 500).json({
      message: String(error?.message || "").startsWith("KYC_EVIDENCE_") ? "Uploaded KYC evidence could not be verified" : "Identity verification submission failed",
    });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data: profile, error } = await supabase
      .from("kyc_profiles")
      .select(`
        fullName,dob,address,status,created_at,updated_at,
        current_application_id,schema_version,policy_version,workflow_status,assurance_level,verification_mode,
        rejection_reason,reviewed_at,submitted_at,next_review_at,required_action,risk_score,risk_rating,
        identity_verification_status,liveness_status,sanctions_status,pep_screening_status,adverse_media_status,
        nationality,country_of_birth,residence_country,address_line1,address_line2,city,region,postal_code,
        employment_status,occupation,employer_name,source_of_funds,source_of_wealth,account_purpose,
        expected_monthly_volume_band,expected_monthly_tx_count_band,pep_self_declared,pep_related_declared,tax_residencies
      `)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return res.json({ kyc: null });

    let applicationVersion = null;
    let hasIdDocument = false;
    let hasSelfie = false;
    if (profile.current_application_id) {
      const [{ data: app }, { count: idCount }, { count: selfieCount }] = await Promise.all([
        supabase.from("kyc_applications_v3").select("application_version").eq("id", profile.current_application_id).maybeSingle(),
        supabase.from("kyc_evidence_v3").select("id", { count: "exact", head: true }).eq("application_id", profile.current_application_id).eq("evidence_type", "id_front"),
        supabase.from("kyc_evidence_v3").select("id", { count: "exact", head: true }).eq("application_id", profile.current_application_id).eq("evidence_type", "selfie"),
      ]);
      applicationVersion = app?.application_version ?? null;
      hasIdDocument = Number(idCount || 0) > 0;
      hasSelfie = Number(selfieCount || 0) > 0;
    } else {
      // Legacy approved records: expose only presence booleans, never private paths.
      const { data: legacy } = await supabase.from("kyc_profiles").select("id_path,selfie_path").eq("user_id", userId).maybeSingle();
      hasIdDocument = Boolean(legacy?.id_path);
      hasSelfie = Boolean(legacy?.selfie_path);
    }

    return res.json({
      kyc: {
        fullName: profile.fullName,
        dob: profile.dob,
        address: profile.address,
        status: profile.status,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        applicationId: profile.current_application_id,
        applicationVersion,
        schemaVersion: profile.schema_version,
        policyVersion: profile.policy_version,
        workflowStatus: profile.workflow_status,
        assuranceLevel: profile.assurance_level,
        verificationMode: profile.verification_mode,
        rejectionReason: profile.rejection_reason,
        reviewedAt: profile.reviewed_at,
        submittedAt: profile.submitted_at,
        nextReviewAt: profile.next_review_at,
        requiredAction: profile.required_action,
        riskScore: profile.risk_score,
        riskRating: profile.risk_rating,
        identityVerificationStatus: profile.identity_verification_status,
        livenessStatus: profile.liveness_status,
        sanctionsStatus: profile.sanctions_status,
        pepScreeningStatus: profile.pep_screening_status,
        adverseMediaStatus: profile.adverse_media_status,
        hasIdDocument,
        hasSelfie,
        nationality: profile.nationality,
        countryOfBirth: profile.country_of_birth,
        residenceCountry: profile.residence_country,
        addressLine1: profile.address_line1,
        addressLine2: profile.address_line2,
        city: profile.city,
        region: profile.region,
        postalCode: profile.postal_code,
        employmentStatus: profile.employment_status,
        occupation: profile.occupation,
        employerName: profile.employer_name,
        sourceOfFunds: profile.source_of_funds || [],
        sourceOfWealth: profile.source_of_wealth,
        accountPurpose: profile.account_purpose,
        expectedMonthlyVolumeBand: profile.expected_monthly_volume_band,
        expectedMonthlyTxCountBand: profile.expected_monthly_tx_count_band,
        pepSelfDeclared: profile.pep_self_declared === true,
        pepRelatedDeclared: profile.pep_related_declared === true,
        taxResidencies: profile.tax_residencies || [],
      },
    });
  } catch (error) {
    console.error("[kyc-v3] me error:", error);
    return res.status(500).json({ message: "Failed to load identity verification status" });
  }
});

module.exports = router;
