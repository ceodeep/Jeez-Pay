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

module.exports = router;
