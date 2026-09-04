const express = require("express");

const supabase = require("../config/supabase");
const supabaseAdmin = require("../config/supabaseAdmin");
const authMiddleware = require("../middlewares/auth.middleware");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");
const { decryptSensitiveText } = require("../services/kycFieldCrypto.service");

const router = express.Router();
const KYC_BUCKET = "kyc-documents";

function clean(value) {
  return String(value || "").trim();
}

function clampLimit(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 100);
}

function encodeCursor(row) {
  if (!row?.submitted_at || !row?.id) return null;
  return Buffer.from(JSON.stringify({ submittedAt: row.submitted_at, id: row.id }), "utf8").toString("base64url");
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
    if (!parsed?.submittedAt || !parsed?.id) return null;
    if (Number.isNaN(new Date(parsed.submittedAt).getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function currentV3Application(userId) {
  const { data, error } = await supabase
    .from("kyc_applications")
    .select("*")
    .eq("user_id", userId)
    .gte("schema_version", 3)
    .order("application_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function signedUrl(path, seconds = 600) {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(KYC_BUCKET)
    .createSignedUrl(path, seconds);
  if (error) {
    console.error("[kyc v3 admin] signed URL error:", error);
    return null;
  }
  return data?.signedUrl || null;
}

router.get(
  "/kyc/list",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res, next) => {
    try {
      // If V3 is not installed for some reason, let the Phase 5.1 legacy list answer.
      const { data: policyCheck, error: policyError } = await supabase
        .from("kyc_policy_versions")
        .select("version")
        .eq("status", "active")
        .limit(1);
      if (policyError || !policyCheck) return next();

      const limit = clampLimit(req.query.limit);
      const status = clean(req.query.status).toLowerCase();
      const riskTier = clean(req.query.riskTier).toLowerCase();
      const country = clean(req.query.country).toUpperCase();
      const search = clean(req.query.search);
      const cursor = decodeCursor(req.query.cursor);

      let query = supabase
        .from("kyc_applications")
        .select(
          "id,user_id,application_version,schema_version,policy_version,workflow_status,assurance_level,verification_mode,full_name,nationality,residence_country,risk_score,risk_tier,edd_required,screening_status,provider_status,assigned_to,assigned_at,submitted_at,reviewed_at,decision_reason,next_review_at"
        )
        .order("submitted_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

      if (status && status !== "all") {
        const mapped = status === "pending" ? ["submitted", "in_review", "needs_more_info"] : [status];
        query = query.in("workflow_status", mapped);
      }
      if (riskTier && riskTier !== "all") query = query.eq("risk_tier", riskTier);
      if (country && country !== "ALL") query = query.eq("residence_country", country);
      if (cursor) {
        query = query.or(
          `submitted_at.lt.${cursor.submittedAt},and(submitted_at.eq.${cursor.submittedAt},id.lt.${cursor.id})`
        );
      }

      const { data: rows, error } = await query;
      if (error) {
        console.error("[kyc v3 admin] queue error:", error);
        return res.status(500).json({ message: "Failed to load KYC queue" });
      }

      let items = rows || [];
      const hasMore = items.length > limit;
      if (hasMore) items = items.slice(0, limit);

      const userIds = [...new Set(items.map((r) => r.user_id).filter(Boolean))];
      let usersById = new Map();
      if (userIds.length) {
        const { data: users, error: usersError } = await supabase
          .from("users")
          .select("id,phone,wallet_account_number,is_active")
          .in("id", userIds);
        if (usersError) throw usersError;
        usersById = new Map((users || []).map((u) => [u.id, u]));
      }

      if (search) {
        const normalized = search.toLowerCase();
        items = items.filter((item) => {
          const user = usersById.get(item.user_id) || {};
          return [
            item.full_name,
            item.user_id,
            user.phone,
            user.wallet_account_number,
          ].some((value) => String(value || "").toLowerCase().includes(normalized));
        });
      }

      const kycs = items.map((item) => {
        const user = usersById.get(item.user_id) || {};
        return {
          user_id: item.user_id,
          fullName: item.full_name,
          status:
            item.workflow_status === "approved" || item.workflow_status === "rejected"
              ? item.workflow_status
              : "pending",
          workflowStatus: item.workflow_status,
          applicationId: item.id,
          applicationVersion: item.application_version,
          schemaVersion: item.schema_version,
          policyVersion: item.policy_version,
          assuranceLevel: item.assurance_level,
          verificationMode: item.verification_mode,
          nationality: item.nationality,
          residenceCountry: item.residence_country,
          riskScore: item.risk_score,
          riskTier: item.risk_tier,
          eddRequired: item.edd_required,
          screeningStatus: item.screening_status,
          providerStatus: item.provider_status,
          assignedTo: item.assigned_to,
          assignedAt: item.assigned_at,
          created_at: item.submitted_at,
          reviewed_at: item.reviewed_at,
          rejection_reason: item.decision_reason,
          nextReviewAt: item.next_review_at,
          phone: user.phone || null,
          walletAccountNumber: user.wallet_account_number || null,
          userActive: user.is_active !== false,
          // Explicitly no signed document URLs in queue rows.
          id_path: null,
          selfie_path: null,
        };
      });

      const last = items[items.length - 1];
      return res.json({
        kycs,
        page: {
          limit,
          hasMore,
          nextCursor: hasMore ? encodeCursor(last) : null,
        },
      });
    } catch (error) {
      console.error("[kyc v3 admin] list crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/kyc/:userId/detail",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const userId = clean(req.params.userId);
      const app = await currentV3Application(userId);
      if (!app) return res.status(404).json({ message: "KYC application not found" });

      const [docResult, checksResult, screeningsResult, riskResult, eventsResult, userResult] = await Promise.all([
        supabase.from("kyc_documents").select("*").eq("application_id", app.id).maybeSingle(),
        supabase.from("kyc_provider_checks").select("check_type,status,provider,provider_reference,score,result_code,evidence,started_at,completed_at,updated_at").eq("application_id", app.id).order("check_type"),
        supabase.from("kyc_screenings").select("screening_type,status,provider,provider_reference,list_version,match_score,match_count,result_summary,screened_at,next_screen_at").eq("application_id", app.id).order("screening_type"),
        supabase.from("kyc_risk_assessments").select("model_version,score,risk_tier,edd_required,factors,created_at").eq("application_id", app.id).order("created_at", { ascending: false }),
        supabase.from("kyc_review_events").select("id,actor_user_id,event_type,from_status,to_status,reason,snapshot,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
        supabase.from("users").select("id,phone,wallet_account_number,is_active,role").eq("id", userId).maybeSingle(),
      ]);

      const errors = [docResult.error, checksResult.error, screeningsResult.error, riskResult.error, eventsResult.error, userResult.error].filter(Boolean);
      if (errors.length) {
        console.error("[kyc v3 admin] detail lookup error:", errors[0]);
        return res.status(500).json({ message: "Failed to load KYC detail" });
      }

      const doc = docResult.data || null;
      const selfiePath = doc?.metadata?.selfiePath || null;
      const evidence = doc
        ? {
            idFrontUrl: await signedUrl(doc.front_path),
            idBackUrl: await signedUrl(doc.back_path),
            selfieUrl: await signedUrl(selfiePath),
          }
        : { idFrontUrl: null, idBackUrl: null, selfieUrl: null };

      return res.json({
        application: {
          ...app,
          // Never return encrypted values/storage paths in application JSON.
        },
        user: userResult.data || null,
        document: doc
          ? {
              id: doc.id,
              documentType: doc.document_type,
              issuingCountry: doc.issuing_country,
              documentNumberLast4: doc.document_number_last4,
              issueDate: doc.issue_date,
              expiryDate: doc.expiry_date,
              noExpiry: doc.no_expiry,
              captureMethod: doc.capture_method,
              evidenceStrength: doc.evidence_strength,
              verificationStatus: doc.verification_status,
              verificationProvider: doc.verification_provider,
              providerReference: doc.provider_reference,
              createdAt: doc.created_at,
            }
          : null,
        evidence,
        providerChecks: checksResult.data || [],
        screenings: screeningsResult.data || [],
        riskAssessments: riskResult.data || [],
        reviewEvents: eventsResult.data || [],
      });
    } catch (error) {
      console.error("[kyc v3 admin] detail crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/kyc/:userId/document-number",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  async (req, res) => {
    try {
      const userId = clean(req.params.userId);
      const app = await currentV3Application(userId);
      if (!app) return res.status(404).json({ message: "KYC application not found" });

      const { data: doc, error } = await supabase
        .from("kyc_documents")
        .select("document_number_ciphertext,document_number_last4")
        .eq("application_id", app.id)
        .maybeSingle();
      if (error) throw error;
      if (!doc) return res.status(404).json({ message: "KYC document not found" });

      const documentNumber = decryptSensitiveText(doc.document_number_ciphertext);
      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "KYC_SENSITIVE_DOCUMENT_NUMBER_VIEWED",
        targetType: "kyc_application",
        targetId: app.id,
        targetDisplay: userId,
        oldValue: null,
        newValue: { last4: doc.document_number_last4 },
        req,
      });

      res.set("Cache-Control", "no-store");
      return res.json({ documentNumber, last4: doc.document_number_last4 });
    } catch (error) {
      console.error("[kyc v3 admin] sensitive document reveal error:", error);
      return res.status(500).json({ message: "Failed to reveal document number" });
    }
  }
);

router.post(
  "/kyc/:userId/claim",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const userId = clean(req.params.userId);
      const adminId = req.user.userId;
      const app = await currentV3Application(userId);
      if (!app) return res.status(404).json({ message: "KYC application not found" });
      if (["approved", "rejected", "expired", "cancelled"].includes(app.workflow_status)) {
        return res.status(409).json({ message: "KYC application is already closed" });
      }
      if (app.assigned_to && app.assigned_to !== adminId) {
        return res.status(409).json({ code: "KYC_ALREADY_ASSIGNED", message: "This KYC is assigned to another reviewer" });
      }

      const { data, error } = await supabase
        .from("kyc_applications")
        .update({ assigned_to: adminId, assigned_at: app.assigned_at || new Date().toISOString(), workflow_status: app.workflow_status === "submitted" ? "in_review" : app.workflow_status, updated_at: new Date().toISOString() })
        .eq("id", app.id)
        .select("id,assigned_to,assigned_at,workflow_status")
        .single();
      if (error) throw error;

      return res.json({ success: true, application: data });
    } catch (error) {
      console.error("[kyc v3 admin] claim error:", error);
      return res.status(500).json({ message: "Failed to claim KYC application" });
    }
  }
);

router.post(
  "/kyc/:userId/check",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  async (req, res) => {
    try {
      const userId = clean(req.params.userId);
      const app = await currentV3Application(userId);
      if (!app) return res.status(404).json({ message: "KYC application not found" });

      const checkType = clean(req.body.checkType).toLowerCase();
      const status = clean(req.body.status).toLowerCase();
      const provider = clean(req.body.provider) || "manual";
      const evidence = req.body.evidence && typeof req.body.evidence === "object" ? req.body.evidence : {};

      // Do not allow a still-photo manual review to be represented as biometric
      // liveness. Manual liveness may only be asserted for a documented attended session.
      if (checkType === "liveness" && status === "manual_passed" && evidence.attendedSession !== true) {
        return res.status(400).json({ message: "Manual liveness requires documented attended-session evidence" });
      }

      const { data, error } = await supabase.rpc("set_kyc_provider_check_v3", {
        p_admin_user_id: req.user.userId,
        p_application_id: app.id,
        p_check_type: checkType,
        p_status: status,
        p_provider: provider,
        p_provider_reference: clean(req.body.providerReference) || null,
        p_score: req.body.score == null ? null : Number(req.body.score),
        p_result_code: clean(req.body.resultCode) || null,
        p_evidence: evidence,
      });
      if (error) {
        console.error("[kyc v3 admin] provider check RPC error:", error);
        return res.status(400).json({ message: "KYC verification check update failed" });
      }
      return res.json({ success: true, result: data });
    } catch (error) {
      console.error("[kyc v3 admin] provider check error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/kyc/:userId/screening",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  async (req, res) => {
    try {
      const userId = clean(req.params.userId);
      const app = await currentV3Application(userId);
      if (!app) return res.status(404).json({ message: "KYC application not found" });

      const { data, error } = await supabase.rpc("set_kyc_screening_v3", {
        p_admin_user_id: req.user.userId,
        p_application_id: app.id,
        p_screening_type: clean(req.body.screeningType).toLowerCase(),
        p_status: clean(req.body.status).toLowerCase(),
        p_provider: clean(req.body.provider) || "manual",
        p_provider_reference: clean(req.body.providerReference) || null,
        p_list_version: clean(req.body.listVersion) || null,
        p_match_score: req.body.matchScore == null ? null : Number(req.body.matchScore),
        p_match_count: Number(req.body.matchCount || 0),
        p_result_summary: req.body.resultSummary && typeof req.body.resultSummary === "object" ? req.body.resultSummary : {},
      });
      if (error) {
        console.error("[kyc v3 admin] screening RPC error:", error);
        return res.status(400).json({ message: "KYC screening update failed" });
      }
      return res.json({ success: true, result: data });
    } catch (error) {
      console.error("[kyc v3 admin] screening error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

async function reviewV3(req, res, decision, next) {
  try {
    const userId = clean(req.body.userId || req.params.userId);
    if (!userId) return res.status(400).json({ message: "userId is required" });
    const app = await currentV3Application(userId);
    if (!app) return next();

    const reason = clean(req.body.reason || req.body.rejectionReason) || null;
    const { data, error } = await supabase.rpc("review_kyc_v3", {
      p_admin_user_id: req.user.userId,
      p_user_id: userId,
      p_decision: decision,
      p_reason: reason,
    });
    if (error) {
      console.error(`[kyc v3 admin] ${decision} RPC error:`, error);
      return res.status(400).json({ message: "KYC review failed" });
    }
    if (data?.ok !== true) {
      return res.status(409).json(data || { message: "KYC review could not be completed" });
    }

    await logAdminAction({
      adminId: req.user.userId,
      adminPhone: req.adminUser?.phone || null,
      action:
        decision === "approved"
          ? "KYC_V3_APPROVED"
          : decision === "rejected"
            ? "KYC_V3_REJECTED"
            : "KYC_V3_MORE_INFO_REQUESTED",
      targetType: "kyc_application",
      targetId: data.applicationId || app.id,
      targetDisplay: userId,
      oldValue: { workflowStatus: app.workflow_status },
      newValue: data,
      req,
    });

    return res.json({ success: true, ...data });
  } catch (error) {
    console.error(`[kyc v3 admin] ${decision} crash:`, error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

router.post(
  "/kyc/approve",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  (req, res, next) => reviewV3(req, res, "approved", next)
);

router.post(
  "/kyc/reject",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.reject"),
  (req, res, next) => reviewV3(req, res, "rejected", next)
);

router.post(
  "/kyc/:userId/request-more-info",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.reject"),
  (req, res, next) => reviewV3(req, res, "needs_more_info", next)
);

module.exports = router;
