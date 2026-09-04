const express = require("express");
const supabase = require("../config/supabase");
const { merchantAuthMiddleware } = require("../middlewares/merchantAuth.middleware");

const router = express.Router();

function text(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function metadataSizeOk(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= 8192;
  } catch {
    return false;
  }
}

/**
 * Phase 7 merchant payout API.
 * Merchant auth + product policy have already run in app.js. Launch currency
 * is SSP only here and again inside PostgreSQL before the proven Ledger v2
 * payout primitive is reached.
 */
router.post("/payouts", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;

    const idempotencyKey = text(req.body?.idempotency_key);
    const rawAccountNumber = text(req.body?.account_number);
    const amountRaw = text(req.body?.amount);
    const currency = text(req.body?.currency || "SSP").toUpperCase();
    const description = text(req.body?.description);
    const metadata = req.body?.metadata == null ? {} : req.body.metadata;

    if (!idempotencyKey || idempotencyKey.length > 120) {
      return res.status(400).json({
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "idempotency_key must be between 1 and 120 characters",
      });
    }

    if (!/^\d{1,19}$/.test(rawAccountNumber)) {
      return res.status(400).json({
        code: "INVALID_ACCOUNT_NUMBER",
        message: "A valid JeezPay account number is required",
      });
    }

    if (!/^\d+(?:\.\d{1,6})?$/.test(amountRaw)) {
      return res.status(400).json({
        code: "INVALID_AMOUNT",
        message: "A valid payout amount is required",
      });
    }

    const numericAmount = Number(amountRaw);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        code: "INVALID_AMOUNT",
        message: "A valid payout amount is required",
      });
    }

    if (currency !== "SSP") {
      return res.status(400).json({
        code: "UNSUPPORTED_CURRENCY",
        message: "Only SSP merchant payouts are enabled for launch",
      });
    }

    if (description.length > 500) {
      return res.status(400).json({
        code: "INVALID_DESCRIPTION",
        message: "description must not exceed 500 characters",
      });
    }

    if (!isPlainObject(metadata) || !metadataSizeOk(metadata)) {
      return res.status(400).json({
        code: "INVALID_METADATA",
        message: "metadata must be a JSON object no larger than 8KB",
      });
    }

    const accountNumber = rawAccountNumber.replace(/^0+(?=\d)/, "");

    const { data, error } = await supabase.rpc(
      "execute_merchant_payout_ledger_v2",
      {
        p_merchant_id: merchant.id,
        p_idempotency_key: idempotencyKey,
        p_account_number: accountNumber,
        p_amount: amountRaw,
        p_currency: currency,
        p_description: description || null,
        p_metadata: metadata,
      }
    );

    if (error) {
      console.error("[merchant-payouts-v2] rpc error:", {
        message: error.message,
        code: error.code,
      });
      return res.status(500).json({ message: "Failed to process payout" });
    }

    if (!data || typeof data !== "object") {
      console.error("[merchant-payouts-v2] invalid rpc response:", data);
      return res.status(500).json({ message: "Failed to process payout" });
    }

    if (data.ok !== true) {
      const code = text(data.code).slice(0, 80) || "PAYOUT_FAILED";
      const message =
        text(data.message).slice(0, 500) || "Payout could not be completed";

      const statusByCode = {
        INVALID_IDEMPOTENCY_KEY: 400,
        INVALID_ACCOUNT_NUMBER: 400,
        INVALID_AMOUNT: 400,
        INVALID_DESCRIPTION: 400,
        INVALID_METADATA: 400,
        UNSUPPORTED_CURRENCY: 400,
        RECIPIENT_NOT_FOUND: 404,
        RECIPIENT_NOT_ELIGIBLE: 400,
        KYC_REQUIRED: 400,
        WALLET_NOT_FOUND: 400,
        MERCHANT_NOT_FOUND: 404,
        MERCHANT_DISABLED: 403,
        MERCHANT_BALANCE_NOT_FOUND: 400,
        INSUFFICIENT_MERCHANT_BALANCE: 409,
        IDEMPOTENCY_CONFLICT: 409,
      };

      return res.status(statusByCode[code] || 400).json({ code, message });
    }

    return res.status(data.already_processed === true ? 200 : 201).json({
      success: true,
      already_processed: data.already_processed === true,
      payout: data.payout,
    });
  } catch (err) {
    console.error("[merchant-payouts-v2] crash:", err);
    return res.status(500).json({ message: "Failed to process payout" });
  }
});

module.exports = router;
