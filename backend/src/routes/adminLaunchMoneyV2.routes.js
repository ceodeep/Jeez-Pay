const crypto = require("crypto");
const express = require("express");

const router = express.Router();

const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  requireAdmin,
  requirePermission,
} = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");

const PROTECTED_ADMIN_ROLES = new Set([
  "admin",
  "super_admin",
  "finance_admin",
  "kyc_officer",
  "support_agent",
  "auditor",
]);

function normalizePhone(raw) {
  const value = String(raw || "").trim();
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

async function getUserByAdminIdentifier(identifierRaw) {
  const raw = String(identifierRaw || "").trim();
  if (!raw) return null;

  const select = "id, phone, role, wallet_account_number, is_active";

  let result = await supabase
    .from("users")
    .select(select)
    .eq("phone", raw)
    .maybeSingle();

  if (result.error) throw result.error;
  if (result.data) return result.data;

  const normalizedPhone = normalizePhone(raw);
  if (normalizedPhone && normalizedPhone !== raw) {
    result = await supabase
      .from("users")
      .select(select)
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (result.error) throw result.error;
    if (result.data) return result.data;
  }

  if (/^\d+$/.test(raw)) {
    const accountNumber = Number(raw);
    if (Number.isSafeInteger(accountNumber)) {
      result = await supabase
        .from("users")
        .select(select)
        .eq("wallet_account_number", accountNumber)
        .maybeSingle();

      if (result.error) throw result.error;
      if (result.data) return result.data;
    }
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(raw)) {
    result = await supabase
      .from("users")
      .select(select)
      .eq("id", raw)
      .maybeSingle();

    if (result.error) throw result.error;
    if (result.data) return result.data;
  }

  return null;
}

function resolveIdempotencyKey(req) {
  const headerKey = String(req.get("X-Idempotency-Key") || "").trim();
  const bodyKey = String(req.body?.idempotencyKey || "").trim();

  if (headerKey && bodyKey && headerKey !== bodyKey) {
    return {
      error: {
        status: 400,
        body: {
          code: "IDEMPOTENCY_KEY_MISMATCH",
          message: "Idempotency key mismatch",
        },
      },
    };
  }

  const key = headerKey || bodyKey || crypto.randomUUID();
  if (key.length > 120) {
    return {
      error: {
        status: 400,
        body: {
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "Idempotency key is too long",
        },
      },
    };
  }

  return { key };
}

function mapLedgerError(error, fallbackMessage) {
  const message = String(error?.message || "");

  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return {
      status: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "This request key was already used for a different operation",
      },
    };
  }

  if (message.includes("INSUFFICIENT_BALANCE")) {
    return {
      status: 400,
      body: { message: "Insufficient balance for debit adjustment" },
    };
  }

  if (message.includes("PRODUCT_DISABLED") || message.includes("CAPABILITY_DISABLED")) {
    return {
      status: 403,
      body: {
        code: "CAPABILITY_DISABLED",
        message: "This money operation is not enabled for the selected currency",
      },
    };
  }

  if (
    message.includes("RECONCILIATION") ||
    message.includes("MIRROR_NOT_ENABLED") ||
    message.includes("POST_FAILED") ||
    message.includes("BALANCE_MISMATCH") ||
    message.includes("UNBALANCED_JOURNAL")
  ) {
    return {
      status: 503,
      body: {
        code: "LEDGER_TEMPORARILY_UNAVAILABLE",
        message: "Money operation is temporarily unavailable",
      },
    };
  }

  return { status: 400, body: { message: fallbackMessage } };
}

async function bestEffortAudit(payload) {
  try {
    await logAdminAction(payload);
  } catch (error) {
    console.error("[launch-money-v2] audit logging failed:", error);
  }
}

router.post(
  "/wallet/adjust",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;
      const identifier = String(req.body.identifier || "").trim();
      const currency = String(req.body.currency || "").trim().toUpperCase();
      const type = String(req.body.type || "").trim().toLowerCase();
      const amount = Number(req.body.amount);
      const description =
        String(req.body.description || "").trim() || "Admin balance adjustment";

      if (!identifier || !currency || !type || req.body.amount == null) {
        return res.status(400).json({
          message: "identifier, currency, amount and type are required",
        });
      }

      if (!["credit", "debit"].includes(type)) {
        return res.status(400).json({ message: "type must be 'credit' or 'debit'" });
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      if (description.length > 500) {
        return res.status(400).json({ message: "Description is too long" });
      }

      const user = await getUserByAdminIdentifier(identifier);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!user.is_active) {
        return res.status(400).json({ message: "Cannot adjust wallet for suspended user" });
      }

      if (PROTECTED_ADMIN_ROLES.has(user.role)) {
        return res.status(403).json({
          message: "Admin wallets cannot be adjusted from this endpoint",
        });
      }

      const idempotency = resolveIdempotencyKey(req);
      if (idempotency.error) {
        return res.status(idempotency.error.status).json(idempotency.error.body);
      }

      const { data, error } = await supabase.rpc(
        "admin_wallet_adjust_ledger_v2",
        {
          p_admin_user_id: adminId,
          p_target_user_id: user.id,
          p_currency: currency,
          p_amount: amount,
          p_type: type,
          p_description: description,
          p_idempotency_key: idempotency.key,
        }
      );

      if (error) {
        console.error("[admin wallet adjust v2] RPC error:", error);
        const mapped = mapLedgerError(error, "Wallet adjustment failed");
        return res.status(mapped.status).json(mapped.body);
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.ok) {
        return res.status(500).json({ message: "Wallet adjustment failed" });
      }

      let tx = null;
      if (result.transactionId) {
        const txResult = await supabase
          .from("transactions")
          .select("id, wallet_id, type, amount, description, reference, created_at")
          .eq("id", result.transactionId)
          .maybeSingle();

        if (txResult.error) {
          console.error("[admin wallet adjust v2] transaction lookup error:", txResult.error);
        } else {
          tx = txResult.data;
        }
      }

      if (!result.idempotentReplay) {
        await bestEffortAudit({
          adminId,
          adminPhone: adminInfo?.phone || null,
          action: "WALLET_ADJUSTED",
          targetType: "wallet",
          targetId: result.walletId,
          targetDisplay: user.phone || String(user.wallet_account_number || user.id),
          oldValue: {
            currency,
            balance: Number(result.previousBalance || 0),
          },
          newValue: {
            currency,
            balance: Number(result.newBalance || 0),
            adjustmentType: type,
            amount,
            description,
            transactionId: result.transactionId,
            reference: result.reference,
          },
          req,
        });
      }

      return res.json({
        message: `Wallet ${type} successful`,
        user: {
          id: user.id,
          phone: user.phone,
          wallet_account_number: user.wallet_account_number,
        },
        wallet: {
          id: result.walletId,
          currency,
          previousBalance: Number(result.previousBalance || 0),
          newBalance: Number(result.newBalance || 0),
        },
        transaction:
          tx || {
            id: result.transactionId,
            wallet_id: result.walletId,
            type,
            amount,
            description,
            reference: result.reference,
          },
        idempotencyKey: idempotency.key,
        idempotentReplay: Boolean(result.idempotentReplay),
      });
    } catch (error) {
      console.error("[admin wallet adjust v2] crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/withdrawals/:id/approve",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;
      const requestId = String(req.params.id || "").trim();

      if (!requestId) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const { data, error } = await supabase.rpc(
        "approve_fiat_withdrawal_ledger_v2",
        {
          p_admin_user_id: adminId,
          p_request_id: requestId,
        }
      );

      if (error) {
        console.error("[fiat withdrawal approve v2] RPC error:", error);
        const mapped = mapLedgerError(error, "Approval failed");
        return res.status(mapped.status).json(mapped.body);
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.ok) {
        return res.status(400).json({ message: result?.message || "Invalid request" });
      }

      if (!result.idempotentReplay) {
        await bestEffortAudit({
          adminId,
          adminPhone: adminInfo?.phone || null,
          action: "WITHDRAWAL_APPROVED",
          targetType: "withdrawal",
          targetId: requestId,
          targetDisplay: `${result.amount || ""} ${result.currency || ""}`.trim(),
          oldValue: {
            status: "pending",
            walletBalance: Number(result.previousBalance || 0),
          },
          newValue: {
            status: "approved",
            walletBalance: Number(result.newBalance || 0),
            amount: Number(result.amount || 0),
            walletId: result.walletId,
            transactionId: result.transactionId,
            reference: result.reference,
          },
          req,
        });
      }

      return res.json({ message: "Withdrawal approved" });
    } catch (error) {
      console.error("[fiat withdrawal approve v2] crash:", error);
      return res.status(500).json({ message: "Approval failed" });
    }
  }
);

// Referral rewards still have two legacy application callers (signup and KYC
// approval). Keep payout execution disabled until both callers are routed to
// grant_referral_reward_ledger_v2, rather than leaving one direct wallet writer
// reachable during the SSP launch.
router.post(
  "/referral-rewards/settings",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.update"),
  (req, res, next) => {
    if (req.body?.enabled === true) {
      return res.status(403).json({
        code: "REFERRAL_REWARDS_TEMPORARILY_DISABLED",
        message: "Referral reward payouts are temporarily disabled during Ledger migration",
      });
    }

    return next();
  }
);

module.exports = router;
