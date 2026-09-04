const express = require("express");
const { randomUUID } = require("crypto");

const supabase = require("../config/supabase");
const supabaseAdmin = require("../config/supabaseAdmin");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  encryptSensitiveText,
  fingerprintDocumentNumber,
  last4,
} = require("../services/kycFieldCrypto.service");

const router = express.Router();
const KYC_BUCKET = "kyc-documents";
const V3_SCHEMA = 3;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const V3_FILE_TYPES = new Set([
  "id_front",
  "id_back",
  "selfie",
  "proof_of_address",
  "supporting_document",
]);
const V3_CONTENT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

function clean(value) {
  return String(value || "").trim();
}

function isoCountry(value) {
  const v = clean(value).toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

function extensionFor(contentType) {
  return contentType === "image/png" ? "png" : "jpg";
}

function pathPrefixFor(fileType) {
  if (fileType === "id_front") return "id_";
  if (fileType === "id_back") return "id_back_";
  if (fileType === "selfie") return "selfie_";
  if (fileType === "proof_of_address") return "proof_address_";
  return "supporting_";
}

function mapV3Error(error) {
  const message = String(error?.message || "");
  const validationCodes = [
    "KYC_V3_INVALID_ARGUMENTS",
    "KYC_V3_REQUIRED_CORE_ATTRIBUTES",
    "KYC_V3_INVALID_DOB",
    "KYC_V3_INVALID_DOCUMENT",
    "KYC_V3_INVALID_DOCUMENT_EXPIRY",
    "KYC_V3_DOCUMENT_EXPIRED",
    "KYC_V3_REQUIRED_CONSENT_MISSING",
    "KYC_V3_DOCUMENT_PATH_OWNERSHIP_INVALID",
    "KYC_V3_UPLOAD_SESSION_INVALID",
  ];

  if (validationCodes.some((code) => message.includes(code))) {
    return { status: 400, code: "KYC_INVALID_SUBMISSION", message: "KYC submission is incomplete or invalid" };
  }
  if (message.includes("KYC_V3_USER_NOT_ELIGIBLE")) {
    return { status: 403, code: "KYC_USER_NOT_ELIGIBLE", message: "Account is not eligible for KYC" };
  }
  if (message.includes("KYC_FIELD_ENCRYPTION_KEY")) {
    return { status: 503, code: "KYC_SECURITY_CONFIGURATION_UNAVAILABLE", message: "KYC is temporarily unavailable" };
  }
  return { status: 500, code: "KYC_SUBMISSION_FAILED", message: "KYC submission failed" };
}

async function getActivePolicy() {
  const { data, error } = await supabase
    .from("kyc_policy_versions")
    .select("version,policy_code,schema_version,requirements,privacy_notice_version,biometric_notice_version,activated_at")
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

router.get("/policy", authMiddleware, async (_req, res) => {
  try {
    const policy = await getActivePolicy();
    if (!policy) return res.status(503).json({ message: "KYC policy is unavailable" });
    return res.json({
      schemaVersion: policy.schema_version,
      policyVersion: policy.version,
      policyCode: policy.policy_code,
      privacyNoticeVersion: policy.privacy_notice_version,
      biometricNoticeVersion: policy.biometric_notice_version,
      requirements: policy.requirements || {},
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  } catch (error) {
    console.error("[kyc v3] policy error:", error);
    return res.status(500).json({ message: "Failed to load KYC policy" });
  }
});

// Sanitized current KYC projection. This intentionally intercepts the legacy
// /kyc/me route and never returns private storage object paths.
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [{ data: profile, error: profileError }, { data: app, error: appError }] = await Promise.all([
      supabase
        .from("kyc_profiles")
        .select("fullName,dob,address,status,created_at,updated_at,reviewed_at,rejection_reason")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("kyc_applications")
        .select(
          "id,application_version,schema_version,policy_version,workflow_status,assurance_level,verification_mode,full_name,dob,nationality,country_of_birth,residence_country,address_line1,address_line2,city,region,postal_code,employment_status,occupation,employer_name,source_of_funds,account_purpose,expected_monthly_volume_band,expected_monthly_tx_count_band,pep_self_declared,pep_related_declared,risk_tier,edd_required,screening_status,provider_status,submitted_at,reviewed_at,decision_reason,next_review_at"
        )
        .eq("user_id", userId)
        .order("application_version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (profileError || appError) {
      console.error("[kyc v3] me lookup error:", profileError || appError);
      return res.status(500).json({ message: "Failed to fetch KYC" });
    }

    let hasIdDocument = false;
    let hasSelfie = false;
    if (app?.id) {
      const { data: doc, error: docError } = await supabase
        .from("kyc_documents")
        .select("id,front_path,metadata")
        .eq("application_id", app.id)
        .maybeSingle();
      if (docError) {
        console.error("[kyc v3] document state lookup error:", docError);
      } else if (doc) {
        hasIdDocument = Boolean(doc.front_path);
        hasSelfie = Boolean(doc.metadata?.selfiePath);
      }
    } else if (profile) {
      // Legacy profiles are known to have passed the Phase 5.1 required-path rules.
      hasIdDocument = true;
      hasSelfie = true;
    }

    if (!profile && !app) return res.json({ kyc: null });

    const status = profile?.status || (app?.workflow_status === "approved" ? "approved" : "pending");
    const workflowStatus = app?.workflow_status || status;
    const requiredAction =
      workflowStatus === "needs_more_info" || status === "rejected"
        ? "resubmit"
        : workflowStatus === "approved"
          ? "none"
          : "wait_for_review";

    return res.json({
      kyc: {
        // Legacy field names are retained with non-sensitive placeholders so old
        // Android builds remain compatible without learning private object paths.
        fullName: app?.full_name || profile?.fullName || null,
        dob: app?.dob || profile?.dob || null,
        address: app?.address_line1 || profile?.address || null,
        id_path: hasIdDocument ? "uploaded" : null,
        selfie_path: hasSelfie ? "uploaded" : null,
        status,
        created_at: profile?.created_at || app?.submitted_at || null,
        updated_at: profile?.updated_at || app?.submitted_at || null,

        applicationId: app?.id || null,
        applicationVersion: app?.application_version || null,
        schemaVersion: app?.schema_version || 2,
        policyVersion: app?.policy_version || null,
        workflowStatus,
        assuranceLevel: app?.assurance_level || "legacy",
        verificationMode: app?.verification_mode || "manual",
        rejectionReason: profile?.rejection_reason || app?.decision_reason || null,
        reviewedAt: profile?.reviewed_at || app?.reviewed_at || null,
        submittedAt: app?.submitted_at || profile?.created_at || null,
        nextReviewAt: app?.next_review_at || null,
        requiredAction,
        hasIdDocument,
        hasSelfie,

        nationality: app?.nationality || null,
        countryOfBirth: app?.country_of_birth || null,
        residenceCountry: app?.residence_country || null,
        addressLine1: app?.address_line1 || profile?.address || null,
        addressLine2: app?.address_line2 || null,
        city: app?.city || null,
        region: app?.region || null,
        postalCode: app?.postal_code || null,
        employmentStatus: app?.employment_status || null,
        occupation: app?.occupation || null,
        employerName: app?.employer_name || null,
        sourceOfFunds: app?.source_of_funds || [],
        accountPurpose: app?.account_purpose || null,
        expectedMonthlyVolumeBand: app?.expected_monthly_volume_band || null,
        expectedMonthlyTxCountBand: app?.expected_monthly_tx_count_band || null,
        pepSelfDeclared: app?.pep_self_declared || false,
        pepRelatedDeclared: app?.pep_related_declared || false,
      },
    });
  } catch (error) {
    console.error("[kyc v3] me crash:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/upload-url", authMiddleware, async (req, res, next) => {
  try {
    if (Number(req.body?.schemaVersion) !== V3_SCHEMA) return next();

    const userId = req.user.userId;
    const fileType = clean(req.body?.fileType).toLowerCase();
    const contentType = clean(req.body?.contentType).toLowerCase();

    if (!V3_FILE_TYPES.has(fileType) || !V3_CONTENT_TYPES.has(contentType)) {
      return res.status(400).json({ message: "Invalid KYC evidence type" });
    }

    const path = `${userId}/${pathPrefixFor(fileType)}${randomUUID()}.${extensionFor(contentType)}`;
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(KYC_BUCKET)
      .createSignedUploadUrl(path);

    if (signError || !signed?.signedUrl) {
      console.error("[kyc v3] signed upload error:", signError);
      return res.status(500).json({ message: "Failed to create upload URL" });
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: sessionError } = await supabase.from("kyc_upload_sessions").insert({
      user_id: userId,
      object_path: path,
      file_type: fileType,
      content_type: contentType,
      schema_version: V3_SCHEMA,
      expires_at: expiresAt,
    });

    if (sessionError) {
      console.error("[kyc v3] upload session insert error:", sessionError);
      return res.status(500).json({ message: "Failed to prepare KYC upload" });
    }

    return res.json({
      path,
      signedUrl: signed.signedUrl,
      expiresAt,
      maxBytes: MAX_UPLOAD_BYTES,
      schemaVersion: V3_SCHEMA,
    });
  } catch (error) {
    console.error("[kyc v3] upload-url crash:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/submit", authMiddleware, async (req, res, next) => {
  try {
    if (Number(req.body?.schemaVersion) !== V3_SCHEMA) return next();

    const userId = req.user.userId;
    const body = req.body || {};
    const document = body.document || {};
    const consents = body.consents || {};
    const sourceOfFunds = Array.isArray(body.sourceOfFunds)
      ? body.sourceOfFunds.map(clean).filter(Boolean).slice(0, 10)
      : [];

    const countryFields = [body.nationality, body.countryOfBirth, body.residenceCountry, document.issuingCountry];
    if (countryFields.some((value) => !isoCountry(value))) {
      return res.status(400).json({ message: "Valid ISO country codes are required" });
    }

    const requiredStrings = [
      body.fullName,
      body.dob,
      body.addressLine1,
      body.city,
      body.employmentStatus,
      body.occupation,
      body.accountPurpose,
      body.expectedMonthlyVolumeBand,
      document.documentType,
      document.documentNumber,
      document.frontPath,
      document.selfiePath,
    ];
    if (requiredStrings.some((value) => !clean(value)) || sourceOfFunds.length === 0) {
      return res.status(400).json({ message: "Required KYC information is missing" });
    }

    if (
      consents.privacyAccepted !== true ||
      consents.identityVerificationAccepted !== true ||
      consents.biometricAccepted !== true ||
      consents.ongoingScreeningAccepted !== true
    ) {
      return res.status(400).json({ message: "Required KYC consents must be accepted" });
    }

    const policy = await getActivePolicy();
    if (!policy || policy.schema_version !== V3_SCHEMA) {
      return res.status(503).json({ message: "KYC policy is unavailable" });
    }

    const encryptedNumber = encryptSensitiveText(document.documentNumber);
    const numberFingerprint = fingerprintDocumentNumber(document.documentNumber);

    const payload = {
      fullName: clean(body.fullName),
      dob: clean(body.dob),
      nationality: isoCountry(body.nationality),
      countryOfBirth: isoCountry(body.countryOfBirth),
      residenceCountry: isoCountry(body.residenceCountry),
      addressLine1: clean(body.addressLine1),
      addressLine2: clean(body.addressLine2) || null,
      city: clean(body.city),
      region: clean(body.region) || null,
      postalCode: clean(body.postalCode) || null,
      employmentStatus: clean(body.employmentStatus),
      occupation: clean(body.occupation),
      employerName: clean(body.employerName) || null,
      sourceOfFunds,
      sourceOfWealth: clean(body.sourceOfWealth) || null,
      accountPurpose: clean(body.accountPurpose),
      expectedMonthlyVolumeBand: clean(body.expectedMonthlyVolumeBand),
      expectedMonthlyTxCountBand: clean(body.expectedMonthlyTxCountBand) || null,
      pepSelfDeclared: body.pepSelfDeclared === true,
      pepRelatedDeclared: body.pepRelatedDeclared === true,
      taxResidencies: Array.isArray(body.taxResidencies) ? body.taxResidencies.slice(0, 10) : [],
    };

    const documentPayload = {
      documentType: clean(document.documentType).toLowerCase(),
      issuingCountry: isoCountry(document.issuingCountry),
      documentNumberCiphertext: encryptedNumber,
      documentNumberFingerprint: numberFingerprint,
      documentNumberLast4: last4(document.documentNumber),
      issueDate: clean(document.issueDate) || null,
      expiryDate: clean(document.expiryDate) || null,
      noExpiry: document.noExpiry === true,
      frontPath: clean(document.frontPath),
      backPath: clean(document.backPath) || null,
      selfiePath: clean(document.selfiePath),
      captureMethod: "camera",
    };

    const consentPayload = {
      privacyAccepted: true,
      identityVerificationAccepted: true,
      biometricAccepted: true,
      ongoingScreeningAccepted: true,
      privacyNoticeVersion: clean(consents.privacyNoticeVersion),
      biometricNoticeVersion: clean(consents.biometricNoticeVersion),
    };

    const { data, error } = await supabase.rpc("submit_kyc_v3", {
      p_user_id: userId,
      p_payload: payload,
      p_document: documentPayload,
      p_consents: consentPayload,
      p_request_metadata: {
        ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
        userAgent: req.headers["user-agent"] || null,
        clientSchemaVersion: V3_SCHEMA,
      },
    });

    if (error) {
      console.error("[kyc v3] submit RPC error:", { code: error.code, message: error.message });
      const mapped = mapV3Error(error);
      return res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
    }

    const result = data || {};
    if (result.ok !== true) {
      const status = ["KYC_ALREADY_APPROVED", "KYC_ALREADY_PENDING"].includes(result.code) ? 409 : 400;
      return res.status(status).json(result);
    }

    return res.status(201).json({
      message: "KYC submitted for review",
      kyc: {
        status: result.status,
        workflowStatus: result.workflowStatus,
        applicationId: result.applicationId,
        applicationVersion: result.applicationVersion,
        schemaVersion: result.schemaVersion,
        policyVersion: result.policyVersion,
      },
    });
  } catch (error) {
    console.error("[kyc v3] submit crash:", error);
    const mapped = mapV3Error(error);
    return res.status(mapped.status).json({ code: mapped.code, message: mapped.message });
  }
});

module.exports = router;
