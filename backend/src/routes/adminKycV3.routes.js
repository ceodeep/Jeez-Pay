const express = require("express");
const router = express.Router();

const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");

const KYC_BUCKET = "kyc-documents";

function normalize(value) {
  return String(value ?? "").trim();
}

function clampLimit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), max) : fallback;
}

function mapReviewError(error) {
  const message = String(error?.message || "");
  if (message.includes("NOT_AUTHORIZED")) return [403, "KYC review access denied"];
  if (message.includes("KYC_V3_FACE_MATCH_REQUIRED")) return [409, "Selfie-to-document face comparison is required before approval"];
  if (message.includes("KYC_V3_EDD_LIVENESS_REQUIRED")) return [409, "High-risk or PEP KYC requires an attended live identity session before approval"];
  if (message.includes("KYC_V3_MANUAL_FACE_MATCH_EVIDENCE_REQUIRED")) return [400, "Manual face comparison requires reviewer confirmation and notes"];
  if (message.includes("KYC_V3_MANUAL_LIVENESS_EVIDENCE_REQUIRED")) return [400, "Manual liveness requires an attended live session and reviewer notes"];
  if (message.includes("KYC_V3_PROVIDER_LIVENESS_REFERENCE_REQUIRED")) return [400, "Provider liveness verification requires a provider reference"];
  if (message.includes("KYC_V3_INVALID") || message.includes("KYC_V3_REVIEW_REASON")) return [400, "Invalid KYC review request"];
  return [500, "KYC review operation failed"];
}

async function signedEvidenceUrl(objectPath) {
  if (!objectPath) return null;
  const { data, error } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(objectPath, 60 * 10);
  if (error) return null;
  return data?.signedUrl || null;
}

router.get(
  "/kyc/v3/list",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const limit = clampLimit(req.query.limit);
      const workflow = normalize(req.query.workflow).toLowerCase();
      const risk = normalize(req.query.risk).toLowerCase();
      const assignedTo = normalize(req.query.assignedTo);
      const cursorSeqRaw = normalize(req.query.cursorSeq);
      const cursorSeq = cursorSeqRaw ? Number(cursorSeqRaw) : null;

      if (cursorSeqRaw && (!Number.isSafeInteger(cursorSeq) || cursorSeq <= 0)) {
        return res.status(400).json({ message: "Invalid cursor" });
      }

      let query = supabase
        .from("kyc_applications_v3")
        .select(`
          id,review_seq,user_id,application_version,schema_version,policy_version,
          full_name,nationality,residence_country,workflow_status,risk_score,risk_rating,
          assurance_level,required_action,assigned_to,assigned_at,
          submitted_at,reviewed_at,next_review_at,created_at
        `)
        .order("review_seq", { ascending: false })
        .limit(limit + 1);

      if (["submitted", "in_review", "needs_more_info", "approved", "rejected", "expired"].includes(workflow)) {
        query = query.eq("workflow_status", workflow);
      }
      if (["low", "medium", "high"].includes(risk)) query = query.eq("risk_rating", risk);
      if (assignedTo === "me") query = query.eq("assigned_to", req.user.userId);
      if (assignedTo === "unassigned") query = query.is("assigned_to", null);
      if (cursorSeq) query = query.lt("review_seq", cursorSeq);

      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      const last = items[items.length - 1] || null;

      return res.json({
        items,
        pagination: {
          limit,
          hasMore,
          nextCursorSeq: hasMore && last ? Number(last.review_seq) : null,
        },
      });
    } catch (error) {
      console.error("[admin-kyc-v3] list error:", error);
      return res.status(500).json({ message: "Failed to load KYC review queue" });
    }
  }
);

router.get(
  "/kyc/v3/:applicationId",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const applicationId = normalize(req.params.applicationId);
      const { data: application, error } = await supabase
        .from("kyc_applications_v3")
        .select("*")
        .eq("id", applicationId)
        .maybeSingle();
      if (error) throw error;
      if (!application) return res.status(404).json({ message: "KYC application not found" });

      const [documentResult, evidenceResult, checksResult, risksResult, consentResult, eventsResult, userResult] = await Promise.all([
        supabase.from("kyc_documents_v3").select("id,document_type,issuing_country,document_number_last4,issue_date,expiry_date,no_expiry,front_path,back_path,created_at").eq("application_id", applicationId).maybeSingle(),
        supabase.from("kyc_evidence_v3").select("id,evidence_type,object_path,content_type,content_length,sha256,created_at").eq("application_id", applicationId).order("created_at", { ascending: true }),
        supabase.from("kyc_checks_v3").select("id,check_type,status,provider,provider_reference,performed_by,notes,details,created_at").eq("application_id", applicationId).order("created_at", { ascending: false }),
        supabase.from("kyc_risk_assessments_v3").select("id,assessment_type,score,rating,factors,assessed_by,created_at").eq("application_id", applicationId).order("created_at", { ascending: false }),
        supabase.from("kyc_consents_v3").select("privacy_accepted,identity_verification_accepted,biometric_accepted,ongoing_screening_accepted,privacy_notice_version,biometric_notice_version,accepted_at").eq("application_id", applicationId).maybeSingle(),
        supabase.from("kyc_review_events").select("id,actor_user_id,event_type,from_status,to_status,reason,snapshot,created_at").eq("user_id", application.user_id).order("created_at", { ascending: false }).limit(100),
        supabase.from("users").select("id,phone,wallet_account_number,is_active,role").eq("id", application.user_id).maybeSingle(),
      ]);

      const failures = [documentResult, evidenceResult, checksResult, risksResult, consentResult, eventsResult, userResult].filter((r) => r.error);
      if (failures.length) throw failures[0].error;

      const evidence = await Promise.all((evidenceResult.data || []).map(async (item) => ({
        id: item.id,
        evidenceType: item.evidence_type,
        contentType: item.content_type,
        contentLength: item.content_length,
        sha256: item.sha256,
        createdAt: item.created_at,
        signedUrl: await signedEvidenceUrl(item.object_path),
      })));

      const document = documentResult.data
        ? {
            id: documentResult.data.id,
            documentType: documentResult.data.document_type,
            issuingCountry: documentResult.data.issuing_country,
            documentLast4: documentResult.data.document_number_last4,
            issueDate: documentResult.data.issue_date,
            expiryDate: documentResult.data.expiry_date,
            noExpiry: documentResult.data.no_expiry,
            createdAt: documentResult.data.created_at,
          }
        : null;

      return res.json({
        application,
        user: userResult.data || null,
        document,
        evidence,
        checks: checksResult.data || [],
        riskAssessments: risksResult.data || [],
        consents: consentResult.data || null,
        timeline: eventsResult.data || [],
      });
    } catch (error) {
      console.error("[admin-kyc-v3] detail error:", error);
      return res.status(500).json({ message: "Failed to load KYC application" });
    }
  }
);

router.post(
  "/kyc/v3/:applicationId/claim",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const applicationId = normalize(req.params.applicationId);
      const { data, error } = await supabase.rpc("claim_kyc_application_v3", {
        p_admin_user_id: req.user.userId,
        p_application_id: applicationId,
      });
      if (error) {
        const [status, message] = mapReviewError(error);
        return res.status(status).json({ message });
      }
      if (data?.ok !== true) {
        return res.status(data?.code === "KYC_NOT_FOUND" ? 404 : 409).json(data);
      }
      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "KYC_REVIEW_CLAIMED",
        targetType: "kyc_application",
        targetId: applicationId,
        targetDisplay: applicationId,
        newValue: data,
        req,
      });
      return res.json(data);
    } catch (error) {
      console.error("[admin-kyc-v3] claim error:", error);
      return res.status(500).json({ message: "Failed to claim KYC application" });
    }
  }
);

router.post(
  "/kyc/v3/:userId/checks",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  async (req, res) => {
    try {
      const userId = normalize(req.params.userId);
      const { data, error } = await supabase.rpc("record_kyc_check_v3", {
        p_admin_user_id: req.user.userId,
        p_user_id: userId,
        p_check_type: normalize(req.body?.checkType),
        p_status: normalize(req.body?.status),
        p_provider: normalize(req.body?.provider) || null,
        p_provider_reference: normalize(req.body?.providerReference) || null,
        p_notes: normalize(req.body?.notes) || null,
        p_details: req.body?.details && typeof req.body.details === "object" ? req.body.details : {},
      });
      if (error) {
        const [status, message] = mapReviewError(error);
        return res.status(status).json({ message });
      }
      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "KYC_CHECK_RECORDED",
        targetType: "kyc",
        targetId: userId,
        targetDisplay: userId,
        newValue: data,
        req,
      });
      return res.json(data);
    } catch (error) {
      console.error("[admin-kyc-v3] check error:", error);
      return res.status(500).json({ message: "Failed to record KYC check" });
    }
  }
);

async function review(req, res, decision) {
  try {
    const userId = normalize(req.params.userId || req.body?.userId);
    if (!userId) return res.status(400).json({ message: "userId is required" });
    const reason = normalize(req.body?.reason || req.body?.rejectionReason) || null;
    const requiredAction = normalize(req.body?.requiredAction) || null;

    const { data, error } = await supabase.rpc("review_kyc_v3", {
      p_admin_user_id: req.user.userId,
      p_user_id: userId,
      p_decision: decision,
      p_reason: reason,
      p_required_action: requiredAction,
    });
    if (error) {
      const [status, message] = mapReviewError(error);
      return res.status(status).json({ message });
    }
    if (data?.ok !== true) {
      const conflictCodes = new Set([
        "KYC_REVIEW_TERMINAL", "DOCUMENT_VERIFICATION_REQUIRED", "LIVENESS_REQUIRED",
        "SANCTIONS_SCREENING_REQUIRED", "PEP_SCREENING_REQUIRED", "ADVERSE_MEDIA_SCREENING_REQUIRED",
        "SENIOR_APPROVAL_REQUIRED", "SOURCE_OF_WEALTH_REQUIRED", "SANCTIONS_MATCH_BLOCKS_APPROVAL",
      ]);
      const status = data?.code === "KYC_NOT_FOUND" ? 404 : conflictCodes.has(data?.code) ? 409 : 400;
      return res.status(status).json(data);
    }

    await logAdminAction({
      adminId: req.user.userId,
      adminPhone: req.adminUser?.phone || null,
      action: decision === "approved" ? "KYC_APPROVED" : decision === "rejected" ? "KYC_REJECTED" : "KYC_MORE_INFO_REQUESTED",
      targetType: "kyc",
      targetId: userId,
      targetDisplay: userId,
      newValue: data,
      req,
    });
    return res.json(data);
  } catch (error) {
    console.error(`[admin-kyc-v3] ${decision} error:`, error);
    return res.status(500).json({ message: "KYC review failed" });
  }
}

router.post("/kyc/v3/:userId/approve", authMiddleware, requireAdmin, requirePermission("kyc.approve"), (req, res) => review(req, res, "approved"));
router.post("/kyc/v3/:userId/reject", authMiddleware, requireAdmin, requirePermission("kyc.reject"), (req, res) => review(req, res, "rejected"));
router.post("/kyc/v3/:userId/needs-more-info", authMiddleware, requireAdmin, requirePermission("kyc.reject"), (req, res) => review(req, res, "needs_more_info"));

// Preserve existing dashboard contracts during the UI rollout.
router.post("/kyc/approve", authMiddleware, requireAdmin, requirePermission("kyc.approve"), (req, res) => review(req, res, "approved"));
router.post("/kyc/reject", authMiddleware, requireAdmin, requirePermission("kyc.reject"), (req, res) => review(req, res, "rejected"));

module.exports = router;
