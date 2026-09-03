const express = require("express");

const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");

function normalize(value) {
  return String(value || "").trim();
}

function mapReviewRpcError(error) {
  const message = String(error?.message || "");

  if (
    message.includes("KYC_REVIEW_INVALID_ARGUMENTS") ||
    message.includes("KYC_REVIEW_REJECTION_REASON_REQUIRED") ||
    message.includes("KYC_REVIEW_REASON_TOO_LONG")
  ) {
    return { status: 400, message: "Invalid KYC review request" };
  }

  if (message.includes("KYC_REVIEW_ADMIN_NOT_AUTHORIZED")) {
    return { status: 403, message: "KYC review access denied" };
  }

  return { status: 500, message: "KYC review failed" };
}

async function reviewKyc(req, res, decision) {
  try {
    const adminId = req.user.userId;
    const adminInfo = req.adminUser;
    const userId = normalize(req.body.userId);
    const suppliedReason = normalize(req.body.reason || req.body.rejectionReason);
    const reason =
      decision === "rejected"
        ? suppliedReason || "Rejected by reviewer"
        : null;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const { data: before, error: beforeError } = await supabase
      .from("kyc_profiles")
      .select("user_id, status, reviewed_by, reviewed_at, rejection_reason")
      .eq("user_id", userId)
      .maybeSingle();

    if (beforeError) {
      console.error(`[kyc ${decision} v2] lookup error:`, beforeError);
      return res.status(500).json({ message: "KYC lookup failed" });
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "review_kyc_v2",
      {
        p_admin_user_id: adminId,
        p_user_id: userId,
        p_decision: decision,
        p_reason: reason,
      }
    );

    if (rpcError) {
      console.error(`[kyc ${decision} v2] RPC error:`, rpcError);
      const mapped = mapReviewRpcError(rpcError);
      return res.status(mapped.status).json({ message: mapped.message });
    }

    const payload = rpcData || {};

    if (payload.ok !== true) {
      const status = payload.code === "KYC_NOT_FOUND" ? 404 : 409;
      return res.status(status).json({
        code: payload.code || "KYC_REVIEW_REJECTED",
        message: payload.message || "KYC review rejected",
        status: payload.status || null,
      });
    }

    await logAdminAction({
      adminId,
      adminPhone: adminInfo?.phone || null,
      action: decision === "approved" ? "KYC_APPROVED" : "KYC_REJECTED",
      targetType: "kyc",
      targetId: userId,
      targetDisplay: userId,
      oldValue: before || null,
      newValue: {
        status: payload.status,
        reviewedBy: payload.reviewedBy || adminId,
        reviewedAt: payload.reviewedAt || null,
        rejectionReason: payload.rejectionReason || null,
        idempotentReplay: payload.idempotentReplay === true,
      },
      req,
    });

    return res.json({
      message:
        decision === "approved"
          ? "KYC approved successfully"
          : "KYC rejected successfully",
      status: payload.status,
      idempotentReplay: payload.idempotentReplay === true,
      rejectionReason: payload.rejectionReason || null,
    });
  } catch (error) {
    console.error(`[kyc ${decision} v2] crash:`, error);
    return res.status(500).json({
      message: decision === "approved" ? "KYC approval failed" : "KYC rejection failed",
    });
  }
}

router.post(
  "/kyc/approve",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  (req, res) => reviewKyc(req, res, "approved")
);

router.post(
  "/kyc/reject",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.reject"),
  (req, res) => reviewKyc(req, res, "rejected")
);

module.exports = router;
