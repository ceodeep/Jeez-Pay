const express = require("express");

const router = express.Router();

const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  requireAdmin,
  requirePermission,
} = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");

function mapAgentAdminError(error, fallbackMessage) {
  const message = String(error?.message || "");

  if (message.includes("AGENT_DESK_NOT_FOUND")) {
    return {
      status: 404,
      body: { code: "AGENT_DESK_NOT_FOUND", message: "Agent desk not found" },
    };
  }

  if (
    message.includes("AGENT_DESK_KYC_REQUIRED") ||
    message.includes("AGENT_DESK_COMPLIANCE_RESTRICTED") ||
    message.includes("AGENT_DESK_USER_SUSPENDED") ||
    message.includes("AGENT_DESK_NO_ENABLED_CAPABILITY") ||
    message.includes("AGENT_DESK_CASH_IN_PRODUCT_DISABLED") ||
    message.includes("AGENT_DESK_CASH_OUT_PRODUCT_DISABLED")
  ) {
    return {
      status: 409,
      body: { code: message.split(":")[0], message: fallbackMessage },
    };
  }

  if (
    message.includes("AGENT_DESK_INVALID") ||
    message.includes("AGENT_DESK_USER_NOT_ELIGIBLE") ||
    message.includes("AGENT_DESK_PRODUCT_NOT_CONFIGURED")
  ) {
    return {
      status: 400,
      body: { code: message.split(":")[0], message: fallbackMessage },
    };
  }

  if (message.includes("AGENT_DESK_ADMIN_NOT_AUTHORIZED")) {
    return {
      status: 403,
      body: { code: "AGENT_DESK_ADMIN_NOT_AUTHORIZED", message: "Not authorized" },
    };
  }

  return { status: 500, body: { message: fallbackMessage } };
}

async function bestEffortAudit(payload) {
  try {
    await logAdminAction(payload);
  } catch (error) {
    console.error("[agent-desks-v1] audit logging failed:", error);
  }
}

router.get(
  "/agents/v1",
  authMiddleware,
  requireAdmin,
  requirePermission("agents.view"),
  async (_req, res) => {
    try {
      const deskResult = await supabase
        .from("agent_desks_v1")
        .select(
          "id,agent_user_id,desk_code,display_name,country_code,city,address_line,status,activated_at,suspended_at,created_at,updated_at"
        )
        .order("created_at", { ascending: false });

      if (deskResult.error) throw deskResult.error;

      const desks = deskResult.data || [];
      const userIds = [
        ...new Set(desks.map((desk) => desk.agent_user_id).filter(Boolean)),
      ];
      const deskIds = desks.map((desk) => desk.id);

      let users = [];
      let capabilities = [];

      if (userIds.length > 0) {
        const userResult = await supabase
          .from("users")
          .select("id,phone,fullName,role,wallet_account_number,is_active")
          .in("id", userIds);
        if (userResult.error) throw userResult.error;
        users = userResult.data || [];
      }

      if (deskIds.length > 0) {
        const capabilityResult = await supabase
          .from("agent_desk_capabilities_v1")
          .select(
            "desk_id,currency,cash_in_enabled,cash_out_enabled,min_tx_amount,max_tx_amount,daily_cash_in_limit,daily_cash_out_limit,updated_at"
          )
          .in("desk_id", deskIds)
          .order("currency", { ascending: true });
        if (capabilityResult.error) throw capabilityResult.error;
        capabilities = capabilityResult.data || [];
      }

      const usersById = new Map(users.map((user) => [user.id, user]));
      const capsByDesk = new Map();
      for (const cap of capabilities) {
        if (!capsByDesk.has(cap.desk_id)) capsByDesk.set(cap.desk_id, []);
        capsByDesk.get(cap.desk_id).push(cap);
      }

      return res.json({
        agents: desks.map((desk) => ({
          ...desk,
          user: usersById.get(desk.agent_user_id) || null,
          capabilities: capsByDesk.get(desk.id) || [],
        })),
      });
    } catch (error) {
      console.error("[agent-desks-v1] list failed:", error);
      return res.status(500).json({ message: "Failed to load agent desks" });
    }
  }
);

router.post(
  "/agents/v1/:userId/profile",
  authMiddleware,
  requireAdmin,
  requirePermission("agents.manage"),
  async (req, res) => {
    try {
      const userId = String(req.params.userId || "").trim();
      const displayName = String(req.body?.displayName || "").trim();
      const countryCode = String(req.body?.countryCode || "SS")
        .trim()
        .toUpperCase();
      const city = String(req.body?.city || "").trim() || null;
      const addressLine = String(req.body?.addressLine || "").trim() || null;
      const status = String(req.body?.status || "pending")
        .trim()
        .toLowerCase();

      if (!userId || !displayName) {
        return res
          .status(400)
          .json({ message: "userId and displayName are required" });
      }

      const { data, error } = await supabase.rpc(
        "admin_upsert_agent_desk_v1",
        {
          p_admin_user_id: req.user.userId,
          p_agent_user_id: userId,
          p_display_name: displayName,
          p_country_code: countryCode,
          p_city: city,
          p_address_line: addressLine,
          p_status: status,
        }
      );

      if (error) {
        console.error("[agent-desks-v1] profile RPC failed:", error);
        const mapped = mapAgentAdminError(
          error,
          "Agent desk profile update failed"
        );
        return res.status(mapped.status).json(mapped.body);
      }

      await bestEffortAudit({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "AGENT_DESK_PROFILE_UPDATED",
        targetType: "agent_desk",
        targetId: data?.desk?.id || userId,
        targetDisplay: displayName,
        oldValue: null,
        newValue: data,
        req,
      });

      return res.json(data);
    } catch (error) {
      console.error("[agent-desks-v1] profile update crashed:", error);
      return res
        .status(500)
        .json({ message: "Agent desk profile update failed" });
    }
  }
);

router.put(
  "/agents/v1/:userId/capabilities/:currency",
  authMiddleware,
  requireAdmin,
  requirePermission("agents.manage"),
  async (req, res) => {
    try {
      const userId = String(req.params.userId || "").trim();
      const currency = String(req.params.currency || "")
        .trim()
        .toUpperCase();
      const cashInEnabled = req.body?.cashInEnabled === true;
      const cashOutEnabled = req.body?.cashOutEnabled === true;
      const minTxAmount = Number(req.body?.minTxAmount);
      const maxTxAmount =
        req.body?.maxTxAmount == null || req.body?.maxTxAmount === ""
          ? null
          : Number(req.body.maxTxAmount);
      const dailyCashInLimit =
        req.body?.dailyCashInLimit == null || req.body?.dailyCashInLimit === ""
          ? null
          : Number(req.body.dailyCashInLimit);
      const dailyCashOutLimit =
        req.body?.dailyCashOutLimit == null ||
        req.body?.dailyCashOutLimit === ""
          ? null
          : Number(req.body.dailyCashOutLimit);

      if (
        !userId ||
        !currency ||
        !Number.isFinite(minTxAmount) ||
        minTxAmount <= 0
      ) {
        return res.status(400).json({
          message: "Valid userId, currency and minTxAmount are required",
        });
      }

      if (
        maxTxAmount !== null &&
        (!Number.isFinite(maxTxAmount) || maxTxAmount < minTxAmount)
      ) {
        return res.status(400).json({
          message: "maxTxAmount must be greater than or equal to minTxAmount",
        });
      }

      if (
        cashInEnabled &&
        (!Number.isFinite(dailyCashInLimit) ||
          dailyCashInLimit < minTxAmount)
      ) {
        return res.status(400).json({
          message:
            "dailyCashInLimit must be greater than or equal to minTxAmount when cash-in is enabled",
        });
      }

      if (
        cashOutEnabled &&
        (!Number.isFinite(dailyCashOutLimit) ||
          dailyCashOutLimit < minTxAmount)
      ) {
        return res.status(400).json({
          message:
            "dailyCashOutLimit must be greater than or equal to minTxAmount when cash-out is enabled",
        });
      }

      const { data, error } = await supabase.rpc(
        "admin_set_agent_desk_capability_v1",
        {
          p_admin_user_id: req.user.userId,
          p_agent_user_id: userId,
          p_currency: currency,
          p_cash_in_enabled: cashInEnabled,
          p_cash_out_enabled: cashOutEnabled,
          p_min_tx_amount: minTxAmount,
          p_max_tx_amount: maxTxAmount,
          p_daily_cash_in_limit: Number.isFinite(dailyCashInLimit)
            ? dailyCashInLimit
            : null,
          p_daily_cash_out_limit: Number.isFinite(dailyCashOutLimit)
            ? dailyCashOutLimit
            : null,
        }
      );

      if (error) {
        console.error("[agent-desks-v1] capability RPC failed:", error);
        const mapped = mapAgentAdminError(
          error,
          "Agent desk capability update failed"
        );
        return res.status(mapped.status).json(mapped.body);
      }

      await bestEffortAudit({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "AGENT_DESK_CAPABILITY_UPDATED",
        targetType: "agent_desk",
        targetId: data?.capability?.desk_id || userId,
        targetDisplay: `${userId} ${currency}`,
        oldValue: null,
        newValue: data,
        req,
      });

      return res.json(data);
    } catch (error) {
      console.error("[agent-desks-v1] capability update crashed:", error);
      return res
        .status(500)
        .json({ message: "Agent desk capability update failed" });
    }
  }
);

module.exports = router;
