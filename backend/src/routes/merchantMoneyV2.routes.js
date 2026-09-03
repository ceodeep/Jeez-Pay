const express = require("express");
const supabase = require("../config/supabase");
const { merchantAuthMiddleware } = require("../middlewares/merchantAuth.middleware");

const router = express.Router();

function cleanString(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

/**
 * Phase 4.3C merchant payout cutover.
 *
 * Product policy has already run in app.js. This route preserves the existing
 * merchant authentication, validation, status-code mapping, and response shape;
 * only the money RPC changes to the native Ledger v2 wrapper proven in 4.3B.
 */
router.post("/payouts", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;

    const idempotencyKey = cleanString(req.body.idempotency_key, 120);
    const rawAccountNumber = cleanString(req.body.account_number, 40);
    const amountRaw = cleanString(req.body.amount, 80);
    const currency = cleanString(req.body.currency, 12).toUpperCase();
    const description = cleanString(req.body.description, 500);
    const metadata =
      req.body.metadata &&
      typeof req.body.metadata === "object" &&
      !Array.isArray(req.body.metadata)
        ? req.body.metadata
        : {};

    if (!idempotencyKey) {
      return res.status(400).json({
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "idempotency_key is required",
      });
    }

    if (!rawAccountNumber || !/^\d{1,19}$/.test(rawAccountNumber)) {
      return res.status(400).json({
        code: "INVALID_ACCOUNT_NUMBER",
        message: "A valid JeezPay account number is required",
      });
    }

    if (!/^\d+(?:\.\d{1,6})?$/.test(amountRaw) || Number(amountRaw) <= 0) {
      return res.status(400).json({
        code: "INVALID_AMOUNT",
        message: "A valid payout amount is required",
      });
    }

    if (!["SSP", "USDT"].includes(currency)) {
      return res.status(400).json({
        code: "UNSUPPORTED_CURRENCY",
        message: "Only SSP and USDT merchant payouts are supported",
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
      const code = cleanString(data.code, 80) || "PAYOUT_FAILED";
      const message =
        cleanString(data.message, 500) || "Payout could not be completed";

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

      return res.status(statusByCode[code] || 400).json({
        code,
        message,
      });
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
