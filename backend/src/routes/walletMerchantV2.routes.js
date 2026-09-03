const express = require("express");
const bcrypt = require("bcrypt");

const supabase = require("../config/supabase");
const { transferLimiter } = require("../middlewares/rateLimit.middleware");

const router = express.Router();

async function requireKycApproved(userId) {
  const { data: kyc, error: kycErr } = await supabase
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (kycErr) throw kycErr;
  return !!kyc && kyc.status === "approved";
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

/**
 * Phase 4.3C merchant-payment confirmation cutover.
 *
 * Authentication and wallet product policy have already run in app.js before
 * this router. The validation/response contract intentionally mirrors the
 * legacy wallet route; only the money RPC changes to the native Ledger v2
 * wrapper proven in Phase 4.3B.
 */
router.post("/merchant-payments/:id/confirm", transferLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;
    const paymentId = String(req.params.id || "").trim();
    const pin = String(req.body.pin || "").trim();

    if (!paymentId) {
      return res.status(400).json({ message: "Payment ID is required" });
    }

    if (!pin) {
      return res.status(400).json({
        code: "PIN_REQUIRED",
        message: "PIN is required",
      });
    }

    const okKyc = await requireKycApproved(userId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before merchant payments",
      });
    }

    const pinState = await getUserPinState(userId);
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

        await updatePinFail(userId, attempts, lockedUntil);

        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many wrong attempts. Locked for 5 minutes.",
        });
      }

      await updatePinFail(userId, attempts, null);

      return res.status(403).json({
        code: "PIN_INVALID",
        message: "Invalid PIN",
      });
    }

    await resetPinFail(userId);

    const { data, error } = await supabase.rpc(
      "confirm_merchant_payment_ledger_v2",
      {
        p_user_id: userId,
        p_payment_id: paymentId,
      }
    );

    if (error) {
      console.error("[merchant-payment-confirm-v2] rpc error:", {
        message: error.message,
        code: error.code,
      });
      return res.status(500).json({ message: "Payment confirmation failed" });
    }

    const result = data || {};

    if (!result.ok) {
      const code = result.code || "PAYMENT_FAILED";

      const statusByCode = {
        PAYMENT_NOT_FOUND: 404,
        PAYMENT_EXPIRED: 400,
        PAYMENT_NOT_PENDING: 400,
        INSUFFICIENT_BALANCE: 400,
        WALLET_NOT_FOUND: 400,
        MERCHANT_DISABLED: 400,
        UNSUPPORTED_CURRENCY: 400,
      };

      return res.status(statusByCode[code] || 400).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error("[merchant-payment-confirm-v2] crash:", err);
    return res.status(500).json({ message: "Payment confirmation failed" });
  }
});

module.exports = router;
