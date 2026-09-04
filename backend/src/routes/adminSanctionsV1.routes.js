const express = require("express");
const router = express.Router();

const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");

function normalize(value) {
  return String(value ?? "").trim();
}

router.get(
  "/sanctions/v1/sources",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("sanctions_sources_v1")
        .select("source_code,source_name,status,last_success_at,data_date,record_count,alias_count")
        .order("source_code", { ascending: true });
      if (error) throw error;
      return res.json({ sources: data || [] });
    } catch (error) {
      console.error("[sanctions-v1] sources error:", error);
      return res.status(500).json({ message: "Failed to load sanctions source status" });
    }
  }
);

router.post(
  "/kyc/v3/:userId/screen-sanctions",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  async (req, res) => {
    try {
      const userId = normalize(req.params.userId);
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const { data, error } = await supabase.rpc("screen_kyc_sanctions_public_v1", {
        p_admin_user_id: req.user.userId,
        p_user_id: userId,
      });
      if (error) {
        console.error("[sanctions-v1] screening RPC error:", { message: error.message, code: error.code });
        if (String(error.message || "").includes("NOT_AUTHORIZED")) {
          return res.status(403).json({ message: "Sanctions screening access denied" });
        }
        return res.status(500).json({ message: "Sanctions screening failed" });
      }

      if (data?.ok !== true) {
        const status = data?.code === "KYC_NOT_FOUND" || data?.code === "KYC_APPLICATION_NOT_FOUND" ? 404
          : data?.code === "SANCTIONS_DATASET_STALE" ? 503
            : 409;
        return res.status(status).json(data);
      }

      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "KYC_SANCTIONS_SCREENED",
        targetType: "kyc",
        targetId: userId,
        targetDisplay: userId,
        newValue: {
          status: data.status,
          topScore: data.topScore,
          topNameSimilarity: data.topNameSimilarity,
          candidateCount: Array.isArray(data.candidates) ? data.candidates.length : 0,
          engine: "JEEZPAY_PUBLIC_SANCTIONS_V1",
        },
        req,
      });

      return res.json(data);
    } catch (error) {
      console.error("[sanctions-v1] screening crash:", error);
      return res.status(500).json({ message: "Sanctions screening failed" });
    }
  }
);

module.exports = router;
