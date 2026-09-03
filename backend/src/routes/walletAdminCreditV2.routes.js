const crypto = require("crypto");
const express = require("express");

const router = express.Router();
const supabase = require("../config/supabase");

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
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

function mapLedgerError(error) {
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

  if (message.includes("PRODUCT_DISABLED") || message.includes("CAPABILITY_DISABLED")) {
    return {
      status: 403,
      body: {
        code: "CAPABILITY_DISABLED",
        message: "This wallet product is not enabled",
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
        message: "Wallet credit is temporarily unavailable",
      },
    };
  }

  return { status: 400, body: { message: "Wallet credit failed" } };
}

router.post("/credit", async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { userId, amount, description } = req.body;
    const currency = normalizeCurrency(req.body.currency || "SSP");

    const { data: adminUser, error: adminErr } = await supabase
      .from("users")
      .select("role, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (adminErr) {
      console.error("[wallet credit v2] admin lookup error:", adminErr);
      return res.status(500).json({ message: "Admin lookup failed" });
    }

    // Preserve the legacy endpoint's authorization semantics exactly.
    if (!adminUser || adminUser.role !== "admin" || adminUser.is_active === false) {
      return res.status(403).json({ message: "Only admin can credit wallets" });
    }

    if (!userId || amount == null) {
      return res.status(400).json({ message: "userId and amount required" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const normalizedDescription =
      String(description || "").trim() || "Admin top-up";

    if (normalizedDescription.length > 500) {
      return res.status(400).json({ message: "Description is too long" });
    }

    const idempotency = resolveIdempotencyKey(req);
    if (idempotency.error) {
      return res.status(idempotency.error.status).json(idempotency.error.body);
    }

    const { data, error } = await supabase.rpc(
      "admin_wallet_adjust_ledger_v2",
      {
        p_admin_user_id: adminId,
        p_target_user_id: userId,
        p_currency: currency,
        p_amount: numericAmount,
        p_type: "credit",
        p_description: normalizedDescription,
        p_idempotency_key: idempotency.key,
      }
    );

    if (error) {
      console.error("[wallet credit v2] RPC error:", error);
      const mapped = mapLedgerError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok) {
      return res.status(500).json({ message: "Wallet credit failed" });
    }

    return res.json({
      message: "Wallet credited",
      userId,
      currency,
      newBalance: Number(result.newBalance || 0),
      idempotencyKey: idempotency.key,
      idempotentReplay: Boolean(result.idempotentReplay),
    });
  } catch (error) {
    console.error("[wallet credit v2] crash:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
