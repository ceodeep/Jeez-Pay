const express = require("express");
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");

const supabase = require("../config/supabase");
const { transferLimiter } = require("../middlewares/rateLimit.middleware");

const router = express.Router();

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePhoneSudan(raw) {
  const p = String(raw || "").trim();
  const digits = p.replace(/\D/g, "");

  if (digits.startsWith("0") && digits.length >= 10) {
    return "+249" + digits.substring(1);
  }
  if (digits.startsWith("249")) {
    return "+249" + digits.substring(3);
  }
  if (p.startsWith("+") && digits.length >= 8) {
    return "+" + digits;
  }
  if (digits.length === 9) {
    return "+249" + digits;
  }
  return p;
}

async function getUserByIdentifier(identifierRaw) {
  const raw = String(identifierRaw || "").trim();
  const digitsOnly = /^\d+$/.test(raw);

  let { data, error } = await supabase
    .from("users")
    .select(
      "id, phone, role, wallet_account_number, fullName, phone_verified"
    )
    .eq("phone", raw)
    .eq("phone_verified", true)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const phoneNorm = normalizePhoneSudan(raw);
  if (phoneNorm !== raw) {
    const normalizedLookup = await supabase
      .from("users")
      .select(
        "id, phone, role, wallet_account_number, fullName, phone_verified"
      )
      .eq("phone", phoneNorm)
      .eq("phone_verified", true)
      .maybeSingle();

    if (normalizedLookup.error) throw normalizedLookup.error;
    if (normalizedLookup.data) return normalizedLookup.data;
  }

  if (digitsOnly) {
    const accountNumber = Number(raw);
    if (Number.isSafeInteger(accountNumber)) {
      const accountLookup = await supabase
        .from("users")
        .select("id, phone, role, wallet_account_number, fullName")
        .eq("wallet_account_number", accountNumber)
        .maybeSingle();

      if (accountLookup.error) throw accountLookup.error;
      if (accountLookup.data) return accountLookup.data;
    }
  }

  return null;
}

async function requireKycApproved(userId) {
  const { data, error } = await supabase
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return !!data && data.status === "approved";
}

async function getUserPinState(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updatePinFail(userId, attempts, lockedUntil) {
  const { error } = await supabase
    .from("users")
    .update({
      pin_failed_attempts: attempts,
      pin_locked_until: lockedUntil || null,
    })
    .eq("id", userId);

  if (error) throw error;
}

async function resetPinFail(userId) {
  const { error } = await supabase
    .from("users")
    .update({
      pin_failed_attempts: 0,
      pin_locked_until: null,
    })
    .eq("id", userId);

  if (error) throw error;
}

async function getCurrencySettings(currency) {
  const { data, error } = await supabase
    .from("currency_settings")
    .select(`
      currency,
      fee_percent,
      flat_fee,
      min_transfer,
      max_transfer,
      is_enabled
    `)
    .eq("currency", currency)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function resolveIdempotencyKey(req) {
  const headerValue = String(req.get("X-Idempotency-Key") || "").trim();
  const bodyValue = String(req.body?.idempotencyKey || "").trim();

  if (headerValue && bodyValue && headerValue !== bodyValue) {
    return {
      error: {
        code: "IDEMPOTENCY_KEY_MISMATCH",
        message: "Header and body idempotency keys must match",
      },
    };
  }

  const supplied = headerValue || bodyValue;
  if (supplied.length > 160) {
    return {
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency key must be 160 characters or fewer",
      },
    };
  }

  return {
    key: supplied || randomUUID(),
    clientSupplied: Boolean(supplied),
  };
}

function mapNativeTransferError(error) {
  const message = String(error?.message || "Transfer failed");

  if (message.includes("LEDGER_P2P_IDEMPOTENCY_CONFLICT")) {
    return {
      status: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "This idempotency key was already used for a different transfer",
      },
    };
  }

  if (
    message.includes("LEDGER_P2P_PRE_RECONCILIATION_FAILED") ||
    message.includes("LEDGER_P2P_POST_RECONCILIATION_FAILED") ||
    message.includes("LEDGER_P2P_PRE_BALANCE_MISMATCH") ||
    message.includes("LEDGER_P2P_POST_BALANCE_MISMATCH") ||
    message.includes("LEDGER_P2P_LEGACY_MIRROR_NOT_ENABLED")
  ) {
    return {
      status: 503,
      body: {
        code: "TRANSFER_TEMPORARILY_UNAVAILABLE",
        message: "Transfers are temporarily unavailable",
      },
    };
  }

  return {
    status: 400,
    body: { message },
  };
}

/**
 * Phase 4.2B user-to-user transfer route.
 *
 * The app-level /wallet middleware has already authenticated the user and
 * enforced product capability policy before this router runs. Existing clients
 * remain compatible: an idempotency key is optional, while clients that send
 * X-Idempotency-Key (or body.idempotencyKey) receive safe replay semantics.
 */
router.post("/transfer", transferLimiter, async (req, res) => {
  try {
    const senderId = req.user.userId;

    const { data: senderUser, error: senderErr } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", senderId)
      .maybeSingle();

    if (senderErr) {
      console.error("transfer sender lookup error:", senderErr);
      return res.status(500).json({ message: "Sender lookup failed" });
    }

    if (!senderUser || senderUser.is_active === false) {
      return res.status(403).json({ message: "Account is suspended" });
    }

    const okKyc = await requireKycApproved(senderId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before transfers",
      });
    }

    const pin = String(req.body.pin || "").trim();
    if (!pin) {
      return res.status(400).json({
        code: "PIN_REQUIRED",
        message: "PIN is required",
      });
    }

    const pinState = await getUserPinState(senderId);
    if (!pinState?.pin_hash) {
      return res.status(400).json({
        code: "PIN_NOT_SET",
        message: "PIN not set for this account",
      });
    }

    if (pinState.pin_locked_until) {
      const lockedUntil = new Date(pinState.pin_locked_until);
      if (lockedUntil > new Date()) {
        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many attempts. Try again later.",
        });
      }
    }

    const okPin = await bcrypt.compare(pin, pinState.pin_hash);
    if (!okPin) {
      const attempts = (pinState.pin_failed_attempts || 0) + 1;

      if (attempts >= 5) {
        const lockedUntil = new Date(
          Date.now() + 5 * 60 * 1000
        ).toISOString();
        await updatePinFail(senderId, attempts, lockedUntil);
        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many wrong attempts. Locked for 5 minutes.",
        });
      }

      await updatePinFail(senderId, attempts, null);
      return res.status(403).json({
        code: "PIN_INVALID",
        message: "Invalid PIN",
      });
    }

    await resetPinFail(senderId);

    const phoneRaw = String(req.body.phone || "").trim();
    const amountRaw = req.body.amount;
    const currency = normalizeCurrency(req.body.currency);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || amountRaw == null || !currency) {
      return res.status(400).json({
        message: "phone, amount, currency required",
      });
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const idempotency = resolveIdempotencyKey(req);
    if (idempotency.error) {
      return res.status(400).json(idempotency.error);
    }

    const settings = await getCurrencySettings(currency);
    if (!settings) {
      return res.status(400).json({ message: "Currency not supported" });
    }

    if (!settings.is_enabled) {
      return res.status(400).json({
        message: "This currency is currently disabled",
      });
    }

    if (settings.min_transfer && amount < Number(settings.min_transfer)) {
      return res.status(400).json({
        message: `Minimum transfer is ${settings.min_transfer} ${currency}`,
      });
    }

    if (settings.max_transfer && amount > Number(settings.max_transfer)) {
      return res.status(400).json({
        message: `Maximum transfer is ${settings.max_transfer} ${currency}`,
      });
    }

    const percentFee =
      (amount * Number(settings.fee_percent || 0)) / 100;
    const flatFee = Number(settings.flat_fee || 0);
    const fee = percentFee + flatFee;
    const totalDebit = amount + fee;

    const receiverUser = await getUserByIdentifier(phoneRaw);
    if (!receiverUser) {
      return res.status(400).json({ message: "Receiver not found" });
    }

    const { data: receiverActive, error: receiverActiveErr } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", receiverUser.id)
      .maybeSingle();

    if (receiverActiveErr) {
      console.error("transfer receiver lookup error:", receiverActiveErr);
      return res.status(500).json({ message: "Receiver lookup failed" });
    }

    if (!receiverActive || receiverActive.is_active === false) {
      return res.status(400).json({
        message: "Receiver account is suspended",
      });
    }

    if (receiverUser.id === senderId) {
      return res.status(400).json({
        message: "You can't send money to yourself",
      });
    }

    const phoneNorm = normalizePhoneSudan(phoneRaw);

    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "wallet_transfer_ledger_v2",
      {
        p_sender_user_id: senderId,
        p_receiver_phone: phoneRaw,
        p_currency: currency,
        p_amount: amount,
        p_description: description || `Sent to ${phoneNorm}`,
        p_idempotency_key: idempotency.key,
      }
    );

    if (rpcErr) {
      console.error("Ledger v2 P2P transfer error:", {
        message: rpcErr.message,
        code: rpcErr.code,
      });
      const mappedError = mapNativeTransferError(rpcErr);
      return res.status(mappedError.status).json(mappedError.body);
    }

    const payload = Array.isArray(rpcData) ? rpcData[0] || {} : rpcData || {};

    return res.json({
      message: payload.message || "Transfer successful",
      currency: payload.currency || currency,
      amount: Number(amount),
      fee: Number(fee),
      totalDebited: Number(totalDebit),
      phone: payload.phone || phoneNorm,
      reference: payload.reference || null,
      idempotencyKey: idempotency.key,
      idempotentReplay: payload.idempotentReplay === true,
    });
  } catch (error) {
    console.error("transfer crash:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
