const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const bcrypt = require("bcrypt");

function normalizeCurrency(cur) {
  return String(cur || "").trim().toUpperCase();
}

async function ensureWallet(userId, currency) {
  currency = normalizeCurrency(currency);

  const { data: wallet, error } = await supabase
    .from("wallets")
    .select("id, balance, currency")
    .eq("user_id", userId)
    .eq("currency", currency)
    .maybeSingle();

  if (error) return { wallet: null, error };
  if (wallet) return { wallet, error: null };

  const { data: created, error: createErr } = await supabase
    .from("wallets")
    .insert([{ user_id: userId, currency, balance: 0 }])
    .select("id, balance, currency")
    .single();

  if (createErr) return { wallet: null, error: createErr };
  return { wallet: created, error: null };
}

async function requireKycApproved(userId) {
  const { data: kyc, error } = await supabase
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
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

function validateServiceType(type) {
  const allowed = ["starlink", "telecom", "electricity", "internet", "other"];
  return allowed.includes(String(type || "").trim().toLowerCase());
}

router.post("/request", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const serviceType = String(req.body.serviceType || "").trim().toLowerCase();
    const provider = String(req.body.provider || "").trim() || null;
    const customerReference = String(req.body.customerReference || "").trim();
    const currency = normalizeCurrency(req.body.currency || "USDT");
    const amount = Number(req.body.amount);
    const note = String(req.body.note || "").trim() || null;
    const pin = String(req.body.pin || "").trim();

    if (!validateServiceType(serviceType)) {
      return res.status(400).json({ message: "Invalid service type" });
    }

    if (!customerReference) {
      return res.status(400).json({ message: "Customer reference is required" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Enter a valid amount" });
    }

    if (!pin) {
      return res.status(400).json({ code: "PIN_REQUIRED", message: "PIN is required" });
    }

    const okKyc = await requireKycApproved(userId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before paying services",
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
        const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
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

    const { wallet, error: walletErr } = await ensureWallet(userId, currency);

    if (walletErr || !wallet) {
      console.error("[service request] wallet error:", walletErr);
      return res.status(500).json({ message: "Wallet check failed" });
    }

    const balance = Number(wallet.balance || 0);

    if (balance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    const newBalance = balance - amount;
    const reference = `SRV-${Date.now()}`;

    const { error: updateErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (updateErr) {
      console.error("[service request] balance update error:", updateErr);
      return res.status(500).json({ message: "Payment failed" });
    }

    const { error: txErr } = await supabase.from("transactions").insert({
      wallet_id: wallet.id,
      type: "debit",
      amount,
      description: `Service payment: ${serviceType}`,
      reference,
    });

    if (txErr) {
      console.error("[service request] transaction insert error:", txErr);
    }

    const { data: request, error: insertErr } = await supabase
      .from("service_requests")
      .insert({
        user_id: userId,
        wallet_id: wallet.id,
        service_type: serviceType,
        provider,
        customer_reference: customerReference,
        currency,
        amount,
        status: "pending",
        note,
        transaction_reference: reference,
      })
      .select(`
        id,
        service_type,
        provider,
        customer_reference,
        currency,
        amount,
        status,
        note,
        transaction_reference,
        created_at
      `)
      .single();

    if (insertErr) {
      console.error("[service request] insert error:", insertErr);
      return res.status(500).json({ message: "Service request could not be created" });
    }

    return res.json({
      message: "Service request submitted",
      request,
    });
  } catch (err) {
    console.error("[service request] crash:", err);
    return res.status(500).json({ message: "Service request failed" });
  }
});

router.get("/my-requests", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data, error } = await supabase
      .from("service_requests")
      .select(`
        id,
        service_type,
        provider,
        customer_reference,
        currency,
        amount,
        status,
        note,
        admin_note,
        transaction_reference,
        created_at,
        completed_at,
        rejected_at
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[service requests] fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch service requests" });
    }

    return res.json({
      requests: data || [],
    });
  } catch (err) {
    console.error("[service requests] crash:", err);
    return res.status(500).json({ message: "Failed to fetch service requests" });
  }
});

module.exports = router;