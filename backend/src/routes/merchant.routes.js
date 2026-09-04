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

function normalizeOptionalText(value, max) {
  const valueText = text(value);
  if (!valueText) return { ok: true, value: null };
  if (valueText.length > max) return { ok: false, value: null };
  return { ok: true, value: valueText };
}

function normalizeHttpsCallback(value) {
  const normalized = normalizeOptionalText(value, 1000);
  if (!normalized.ok || normalized.value == null) return normalized;

  try {
    const parsed = new URL(normalized.value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname
    ) {
      return { ok: false, value: null };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, value: null };
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Phase 7 merchant payment-request API.
 * Creation is atomic in PostgreSQL and merchant_order_id is a true idempotency
 * contract: exact replay returns the existing payment, changed semantics return
 * 409. SSP is enforced here, by product policy, and again in PostgreSQL.
 */
router.post("/payments", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;

    const merchantOrderId = text(req.body?.merchant_order_id);
    const amountRaw = text(req.body?.amount);
    const currency = text(req.body?.currency || "SSP").toUpperCase();
    const descriptionResult = normalizeOptionalText(req.body?.description, 500);
    const callbackResult = normalizeHttpsCallback(req.body?.callback_url);
    const successResult = normalizeOptionalText(req.body?.success_url, 1000);
    const cancelResult = normalizeOptionalText(req.body?.cancel_url, 1000);
    const metadata = req.body?.metadata == null ? {} : req.body.metadata;

    if (!merchantOrderId || merchantOrderId.length > 120) {
      return res.status(400).json({
        code: "INVALID_MERCHANT_ORDER_ID",
        message: "merchant_order_id must be between 1 and 120 characters",
      });
    }

    if (!/^\d+(?:\.\d{1,6})?$/.test(amountRaw)) {
      return res.status(400).json({
        code: "INVALID_AMOUNT",
        message: "A valid payment amount is required",
      });
    }

    const numericAmount = Number(amountRaw);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        code: "INVALID_AMOUNT",
        message: "A valid payment amount is required",
      });
    }

    if (currency !== "SSP") {
      return res.status(400).json({
        code: "UNSUPPORTED_CURRENCY",
        message: "Only SSP merchant payments are enabled for launch",
      });
    }

    if (!descriptionResult.ok) {
      return res.status(400).json({
        code: "INVALID_DESCRIPTION",
        message: "description must not exceed 500 characters",
      });
    }

    if (!callbackResult.ok) {
      return res.status(400).json({
        code: "INVALID_CALLBACK_URL",
        message: "callback_url must be a valid HTTPS URL",
      });
    }

    if (!successResult.ok) {
      return res.status(400).json({
        code: "INVALID_SUCCESS_URL",
        message: "success_url must not exceed 1000 characters",
      });
    }

    if (!cancelResult.ok) {
      return res.status(400).json({
        code: "INVALID_CANCEL_URL",
        message: "cancel_url must not exceed 1000 characters",
      });
    }

    if (!isPlainObject(metadata) || !metadataSizeOk(metadata)) {
      return res.status(400).json({
        code: "INVALID_METADATA",
        message: "metadata must be a JSON object no larger than 8KB",
      });
    }

    const { data, error } = await supabase.rpc("create_merchant_payment_v1", {
      p_merchant_id: merchant.id,
      p_merchant_order_id: merchantOrderId,
      p_amount: amountRaw,
      p_currency: currency,
      p_description: descriptionResult.value,
      p_callback_url: callbackResult.value,
      p_success_url: successResult.value,
      p_cancel_url: cancelResult.value,
      p_metadata: metadata,
    });

    if (error) {
      console.error("[merchant-payments-v1] create RPC error:", {
        message: error.message,
        code: error.code,
      });
      return res.status(500).json({ message: "Failed to create payment" });
    }

    if (!data || typeof data !== "object") {
      console.error("[merchant-payments-v1] invalid RPC result:", data);
      return res.status(500).json({ message: "Failed to create payment" });
    }

    if (data.ok !== true) {
      const code = text(data.code).slice(0, 80) || "PAYMENT_CREATE_FAILED";
      const message =
        text(data.message).slice(0, 500) || "Payment could not be created";
      const statusByCode = {
        INVALID_MERCHANT_ORDER_ID: 400,
        INVALID_AMOUNT: 400,
        UNSUPPORTED_CURRENCY: 400,
        INVALID_DESCRIPTION: 400,
        INVALID_METADATA: 400,
        INVALID_CALLBACK_URL: 400,
        INVALID_SUCCESS_URL: 400,
        INVALID_CANCEL_URL: 400,
        MERCHANT_NOT_FOUND: 404,
        MERCHANT_DISABLED: 403,
        IDEMPOTENCY_CONFLICT: 409,
      };

      return res.status(statusByCode[code] || 400).json({ code, message });
    }

    const payment = data.payment;
    if (!payment?.id) {
      console.error("[merchant-payments-v1] payment missing from RPC result:", data);
      return res.status(500).json({ message: "Failed to create payment" });
    }

    return res.status(data.created === true ? 201 : 200).json({
      payment,
      checkout_url: `jeezpay://merchant-pay/${payment.id}`,
      idempotent_replay: data.created !== true,
    });
  } catch (err) {
    console.error("[merchant-payments-v1] create crash:", err);
    return res.status(500).json({ message: "Failed to create payment" });
  }
});

router.get("/payments/:id", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;
    const paymentId = text(req.params.id);

    if (!isUuid(paymentId)) {
      return res.status(400).json({
        code: "INVALID_PAYMENT_ID",
        message: "A valid payment ID is required",
      });
    }

    const { data, error } = await supabase
      .from("merchant_payments")
      .select("*")
      .eq("id", paymentId)
      .eq("merchant_id", merchant.id)
      .maybeSingle();

    if (error) {
      console.error("[merchant-payments] get error:", error);
      return res.status(500).json({ message: "Failed to fetch payment" });
    }

    if (!data) {
      return res.status(404).json({ message: "Payment not found" });
    }

    return res.json({ payment: data });
  } catch (err) {
    console.error("[merchant-payments] get crash:", err);
    return res.status(500).json({ message: "Failed to fetch payment" });
  }
});

router.get(
  "/payments/by-order/:merchantOrderId",
  merchantAuthMiddleware,
  async (req, res) => {
    try {
      const merchant = req.merchant;
      const merchantOrderId = text(req.params.merchantOrderId);

      if (!merchantOrderId || merchantOrderId.length > 120) {
        return res.status(400).json({
          code: "INVALID_MERCHANT_ORDER_ID",
          message: "A valid merchant order ID is required",
        });
      }

      const { data, error } = await supabase
        .from("merchant_payments")
        .select("*")
        .eq("merchant_id", merchant.id)
        .eq("merchant_order_id", merchantOrderId)
        .maybeSingle();

      if (error) {
        console.error("[merchant-payments] get by order error:", error);
        return res.status(500).json({ message: "Failed to fetch payment" });
      }

      if (!data) {
        return res.status(404).json({ message: "Payment not found" });
      }

      return res.json({ payment: data });
    } catch (err) {
      console.error("[merchant-payments] get by order crash:", err);
      return res.status(500).json({ message: "Failed to fetch payment" });
    }
  },
);

/**
 * The payout writer intentionally lives only in merchantMoneyV2.routes.js.
 * Keeping a second legacy POST /payouts handler here would make money behavior
 * depend on Express router ordering and could bypass the native Ledger wrapper.
 */

router.get(
  "/payouts/by-idempotency/:idempotencyKey",
  merchantAuthMiddleware,
  async (req, res) => {
    try {
      const merchant = req.merchant;
      const idempotencyKey = text(req.params.idempotencyKey);

      if (!idempotencyKey || idempotencyKey.length > 120) {
        return res.status(400).json({
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "A valid idempotency key is required",
        });
      }

      const { data, error } = await supabase
        .from("merchant_payouts")
        .select(
          [
            "id",
            "idempotency_key",
            "recipient_account_number",
            "recipient_name",
            "amount",
            "currency",
            "description",
            "metadata",
            "status",
            "transaction_id",
            "reference",
            "merchant_balance_before",
            "merchant_balance_after",
            "recipient_balance_before",
            "recipient_balance_after",
            "paid_at",
            "created_at",
          ].join(","),
        )
        .eq("merchant_id", merchant.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (error) {
        console.error("[merchant-payouts] lookup error:", error);
        return res.status(500).json({ message: "Failed to fetch payout" });
      }

      if (!data) {
        return res.status(404).json({
          code: "PAYOUT_NOT_FOUND",
          message: "Payout not found",
        });
      }

      return res.json({ payout: data });
    } catch (err) {
      console.error("[merchant-payouts] lookup crash:", err);
      return res.status(500).json({ message: "Failed to fetch payout" });
    }
  },
);

router.get("/recipients/resolve", merchantAuthMiddleware, async (req, res) => {
  try {
    const rawAccountNumber = text(req.query.account_number);

    if (!/^\d{1,19}$/.test(rawAccountNumber)) {
      return res.status(400).json({
        code: "INVALID_ACCOUNT_NUMBER",
        message: "A valid JeezPay account number is required",
      });
    }

    const accountNumber = rawAccountNumber.replace(/^0+(?=\d)/, "");

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, wallet_account_number, fullName, is_active")
      .eq("wallet_account_number", accountNumber)
      .maybeSingle();

    if (userErr) {
      console.error("[merchant-recipient-resolve] user lookup error:", userErr);
      return res.status(500).json({ message: "Recipient lookup failed" });
    }

    if (!user) {
      return res.status(404).json({
        code: "RECIPIENT_NOT_FOUND",
        message: "JeezPay account not found",
      });
    }

    if (user.is_active !== true) {
      return res.status(400).json({
        code: "RECIPIENT_NOT_ELIGIBLE",
        message: "JeezPay account is not eligible to receive payouts",
      });
    }

    const [{ data: kyc, error: kycErr }, { data: controls, error: controlErr }] =
      await Promise.all([
        supabase
          .from("kyc_profiles")
          .select("fullName, status")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("compliance_entity_controls")
          .select("status")
          .eq("entity_type", "USER")
          .eq("entity_ref", String(user.id))
          .in("status", ["review", "frozen"])
          .limit(1),
      ]);

    if (kycErr || controlErr) {
      console.error("[merchant-recipient-resolve] eligibility lookup error:", {
        kyc: kycErr,
        compliance: controlErr,
      });
      return res.status(500).json({ message: "Recipient lookup failed" });
    }

    if (!kyc || kyc.status !== "approved") {
      return res.status(400).json({
        code: "KYC_REQUIRED",
        message: "JeezPay account must have approved KYC before receiving payouts",
      });
    }

    if ((controls || []).length > 0) {
      return res.status(403).json({
        code: "RECIPIENT_RESTRICTED",
        message: "JeezPay account is not eligible to receive payouts",
      });
    }

    const fullName = text(kyc.fullName || user.fullName || "JeezPay User").slice(
      0,
      255,
    );

    return res.json({
      recipient: {
        provider_user_id: user.id,
        wallet_account_number: String(user.wallet_account_number),
        full_name: fullName,
        kyc_status: "approved",
      },
    });
  } catch (err) {
    console.error("[merchant-recipient-resolve] crash:", err);
    return res.status(500).json({ message: "Recipient lookup failed" });
  }
});

module.exports = router;
