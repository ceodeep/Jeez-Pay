const express = require("express");
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");

const router = express.Router();

function clean(value) {
  return String(value || "").trim();
}

function clampLimit(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 100);
}

function decodeCursor(raw) {
  if (!raw) return { submittedAt: null, id: null };
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
    const submittedAt = clean(parsed?.submittedAt);
    const id = clean(parsed?.id);
    if (!submittedAt || !id || Number.isNaN(new Date(submittedAt).getTime())) {
      return { submittedAt: null, id: null };
    }
    return { submittedAt, id };
  } catch {
    return { submittedAt: null, id: null };
  }
}

function encodeCursor(row) {
  if (!row?.submitted_at || !row?.id) return null;
  return Buffer.from(
    JSON.stringify({ submittedAt: row.submitted_at, id: row.id }),
    "utf8"
  ).toString("base64url");
}

router.get(
  "/kyc/list",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res, next) => {
    try {
      const limit = clampLimit(req.query.limit);
      const cursor = decodeCursor(req.query.cursor);

      const { data, error } = await supabase.rpc("search_kyc_queue_v3", {
        p_search: clean(req.query.search) || null,
        p_status: clean(req.query.status) || null,
        p_risk_tier: clean(req.query.riskTier) || null,
        p_country: clean(req.query.country) || null,
        p_cursor_submitted_at: cursor.submittedAt,
        p_cursor_id: cursor.id,
        p_limit: limit + 1,
      });

      if (error) {
        // During staged deployment, fall through if the V3 DB package is not installed yet.
        if (String(error.message || "").includes("search_kyc_queue_v3")) return next();
        console.error("[kyc v3 scale] queue RPC error:", error);
        return res.status(500).json({ message: "Failed to load KYC queue" });
      }

      const rows = Array.isArray(data) ? data : [];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows[pageRows.length - 1];

      return res.json({
        kycs: pageRows.map((item) => ({
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
          phone: item.phone,
          walletAccountNumber: item.wallet_account_number,
          userActive: item.user_active !== false,
          id_path: null,
          selfie_path: null,
        })),
        page: {
          limit,
          hasMore,
          nextCursor: hasMore ? encodeCursor(last) : null,
        },
      });
    } catch (error) {
      console.error("[kyc v3 scale] queue crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/kyc/:userId/claim",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res, next) => {
    try {
      const userId = clean(req.params.userId);
      const { data, error } = await supabase.rpc("claim_kyc_application_v3", {
        p_admin_user_id: req.user.userId,
        p_user_id: userId,
      });

      if (error) {
        if (String(error.message || "").includes("claim_kyc_application_v3")) return next();
        console.error("[kyc v3 scale] claim RPC error:", error);
        return res.status(400).json({ message: "Failed to claim KYC application" });
      }

      if (data?.ok !== true) {
        const status = data?.code === "KYC_V3_APPLICATION_NOT_FOUND" ? 404 : 409;
        return res.status(status).json(data || { message: "KYC claim rejected" });
      }

      return res.json({ success: true, application: data });
    } catch (error) {
      console.error("[kyc v3 scale] claim crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;
