const express = require("express");
const supabase = require("../config/supabase");
const { merchantAuthMiddleware } = require("../middlewares/merchantAuth.middleware");

const router = express.Router();

function cleanString(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function cleanUrl(value, max = 1000) {
  const raw = cleanString(value, max);
  if (!raw) return null;

  if (!raw.startsWith("https://") && !raw.startsWith("http://") && !raw.includes("://")) {
    return raw;
  }

  return raw;
}

router.post("/payments", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;

    const merchantOrderId = cleanString(req.body.merchant_order_id, 120);
    const amount = Number(req.body.amount);
    const currency = cleanString(req.body.currency || "USDT", 12).toUpperCase();
    const description = cleanString(req.body.description, 500);
    const callbackUrl = cleanUrl(req.body.callback_url);
    const successUrl = cleanUrl(req.body.success_url);
    const cancelUrl = cleanUrl(req.body.cancel_url);
    const metadata =
      req.body.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata
        : {};

    if (!merchantOrderId) {
      return res.status(400).json({ message: "merchant_order_id is required" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Valid amount is required" });
    }

    const supportedCurrencies = ["USDT", "SSP"];

    if (!supportedCurrencies.includes(currency)) {
      return res.status(400).json({
        message: "Only USDT and SSP are supported for now",
      });
    }

    const { data: existing, error: existingErr } = await supabase
      .from("merchant_payments")
      .select("*")
      .eq("merchant_id", merchant.id)
      .eq("merchant_order_id", merchantOrderId)
      .maybeSingle();

    if (existingErr) {
      console.error("[merchant-payments] existing lookup error:", existingErr);
      return res.status(500).json({ message: "Failed to create payment" });
    }

    if (existing) {
      return res.status(200).json({
        payment: existing,
        checkout_url: `jeezpay://merchant-pay/${existing.id}`,
      });
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data: payment, error: insertErr } = await supabase
      .from("merchant_payments")
      .insert({
        merchant_id: merchant.id,
        merchant_order_id: merchantOrderId,
        amount,
        currency,
        description,
        callback_url: callbackUrl,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error("[merchant-payments] insert error:", insertErr);
      return res.status(500).json({ message: "Failed to create payment" });
    }

    return res.status(201).json({
      payment,
      checkout_url: `jeezpay://merchant-pay/${payment.id}`,
    });
  } catch (err) {
    console.error("[merchant-payments] create crash:", err);
    return res.status(500).json({ message: "Failed to create payment" });
  }
});

router.get("/payments/:id", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;
    const paymentId = req.params.id;

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

router.get("/payments/by-order/:merchantOrderId", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;
    const merchantOrderId = cleanString(req.params.merchantOrderId, 120);

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
});


/**
 * GET /merchant/recipients/resolve?account_number=...
 *
 * Merchant-only payout destination resolver.
 */
router.get("/recipients/resolve", merchantAuthMiddleware, async (req, res) => {
  try {
    const rawAccountNumber = cleanString(req.query.account_number, 40);

    if (!rawAccountNumber || !/^\d+$/.test(rawAccountNumber)) {
      return res.status(400).json({
        code: "INVALID_ACCOUNT_NUMBER",
        message: "A valid JeezPay account number is required",
      });
    }

    // Postgres stores this as bigint. Keep it as a decimal string in JS.
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

    const { data: kyc, error: kycErr } = await supabase
      .from("kyc_profiles")
      .select("fullName, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (kycErr) {
      console.error("[merchant-recipient-resolve] KYC lookup error:", kycErr);
      return res.status(500).json({ message: "Recipient lookup failed" });
    }

    if (!kyc || kyc.status !== "approved") {
      return res.status(400).json({
        code: "KYC_REQUIRED",
        message: "JeezPay account must have approved KYC before receiving payouts",
      });
    }

    const fullName =
      cleanString(kyc.fullName, 255) ||
      cleanString(user.fullName, 255) ||
      "JeezPay User";

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
