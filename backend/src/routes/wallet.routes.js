const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const bcrypt = require("bcrypt");

// ---- helper: check admin ----
async function isAdmin(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;
  return data.role === "admin";
}

async function getUserRole(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role || null;
}

async function getUserByPhone(phone) {
  const { data, error } = await supabase
    .from("users")
    .select("id, phone, role")
    .eq("phone", phone)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getUserByIdentifier(identifierRaw) {
  const raw = String(identifierRaw || "").trim();
  const digitsOnly = /^\d+$/.test(raw);

  // 1️⃣ Try phone exact
  let { data, error } = await supabase
    .from("users")
    .select("id, phone, role, wallet_account_number")
    .eq("phone", raw)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  // 2️⃣ Try normalized phone
  const phoneNorm = normalizePhoneSudan(raw);
  if (phoneNorm !== raw) {
    const r2 = await supabase
      .from("users")
      .select("id, phone, role, wallet_account_number")
      .eq("phone", phoneNorm)
      .maybeSingle();

    if (r2.error) throw r2.error;
    if (r2.data) return r2.data;
  }

  // 3️⃣ If numeric only, try wallet_account_number
  if (digitsOnly) {
    const acc = Number(raw);
    if (Number.isSafeInteger(acc)) {
      const r3 = await supabase
        .from("users")
        .select("id, phone, role, wallet_account_number")
        .eq("wallet_account_number", acc)
        .maybeSingle();

      if (r3.error) throw r3.error;
      if (r3.data) return r3.data;
    }
  }

  return null;
}

// ---- helper: normalize currency ----
function normalizeCurrency(cur) {
  return String(cur || "").trim().toUpperCase();
}

// ✅ helper: normalize phone (same logic as auth)
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

const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];

// ---- helper: ensure a wallet exists for user+currency ----
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

// ---- helper: KYC gate ----
async function requireKycApproved(userId) {
  const { data: kyc, error: kycErr } = await supabase
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (kycErr) throw kycErr;
  return !!kyc && kyc.status === "approved";
}

// ================= PIN HELPERS =================

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

// ==============================================

/**
 * GET /wallet/balance
 * Returns all balances for the logged-in user
 * Response: { balances: [{currency, balance}] }
 */
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Optional: auto-seed missing currencies for existing users
    for (const cur of DEFAULT_CURRENCIES) {
      const { error } = await ensureWallet(userId, cur);
      if (error) {
        console.error("ensureWallet error:", error);
        return res.status(500).json({ message: "Failed to ensure wallets" });
      }
    }

    const { data, error } = await supabase
      .from("wallets")
      .select("currency, balance")
      .eq("user_id", userId)
      .order("currency", { ascending: true });

    if (error) {
      console.error("balance fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch balances" });
    }

    return res.json({ balances: data || [] });
  } catch (err) {
    console.error("balance crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /wallet/history?currency=USDT
 * Returns last 50 transactions for the selected currency wallet
 */
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currency = normalizeCurrency(req.query.currency || "USDT");

    const { wallet, error } = await ensureWallet(userId, currency);
    if (error) {
      console.error("history ensureWallet error:", error);
      return res.status(500).json({ message: "Wallet check failed" });
    }

    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("type, amount, description, created_at")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (txErr) {
      console.error("history tx fetch error:", txErr);
      return res.status(500).json({ message: "Failed to fetch transactions" });
    }

    return res.json({
      currency,
      transactions: txs || [],
    });
  } catch (err) {
    console.error("history crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /wallet/credit (ADMIN ONLY)
 * Body: { userId, currency, amount, description }
 */
router.post("/credit", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can credit wallets" });
    }

    const { userId, amount, description } = req.body;
    const currency = normalizeCurrency(req.body.currency || "USDT");

    if (!userId || amount == null) {
      return res.status(400).json({ message: "userId and amount required" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const { wallet, error } = await ensureWallet(userId, currency);
    if (error || !wallet) {
      console.error("credit ensureWallet error:", error);
      return res.status(404).json({ message: "Wallet not found" });
    }

    const newBalance = Number(wallet.balance) + numericAmount;

    const { error: txErr } = await supabase.from("transactions").insert({
      wallet_id: wallet.id,
      type: "credit",
      amount: numericAmount,
      description: description || "Admin top-up",
    });

    if (txErr) {
      console.error("credit tx error:", txErr);
      return res.status(500).json({ message: "Transaction failed" });
    }

    const { error: updateErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (updateErr) {
      console.error("credit update error:", updateErr);
      return res.status(500).json({ message: "Balance update failed" });
    }

    return res.json({
      message: "Wallet credited",
      userId,
      currency,
      newBalance,
    });
  } catch (err) {
    console.error("credit crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /wallet/transfer
 * Body: { phone, currency, amount, description }
 * USER -> USER transfer (KYC gated)
 */
router.post("/transfer", authMiddleware, async (req, res) => {
  try {
    const senderId = req.user.userId;
    console.log("[transfer] senderId:", senderId);

    const okKyc = await requireKycApproved(senderId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before transfers",
      });
    }

    // ✅ PIN check
    const pin = String(req.body.pin || "").trim();
    if (!pin) {
      return res.status(400).json({ code: "PIN_REQUIRED", message: "PIN is required" });
    }

    const pinState = await getUserPinState(senderId);
    if (!pinState?.pin_hash) {
      return res.status(400).json({ code: "PIN_NOT_SET", message: "PIN not set for this account" });
    }

    // lockout
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

      // lock after 5 wrong tries for 5 minutes
      if (attempts >= 5) {
        const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await updatePinFail(senderId, attempts, lockedUntil);
        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many wrong attempts. Locked for 5 minutes.",
        });
      } else {
        await updatePinFail(senderId, attempts, null);
        return res.status(403).json({
          code: "PIN_INVALID",
          message: "Invalid PIN",
        });
      }
    }

    // ✅ PIN correct: reset counters
    await resetPinFail(senderId);

    // ===== your existing transfer logic =====
    const phoneRaw = String(req.body.phone || "").trim();
    const amountRaw = req.body.amount;
    const currency = normalizeCurrency(req.body.currency);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || amountRaw == null || !currency) {
      return res.status(400).json({ message: "phone, amount, currency required" });
    }

    const phoneNorm = normalizePhoneSudan(phoneRaw);

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const receiverUser = await getUserByIdentifier(phoneRaw);
    if (!receiverUser) {
      return res.status(400).json({ message: "Receiver not found" });
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: senderId,
      p_receiver_phone: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Sent to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("RPC transfer error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Transfer failed" });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const payload = row?.wallet_transfer ?? row ?? {};

    return res.json({
      message: payload.message || "Transfer successful",
      currency: payload.currency || currency,
      amount: Number(payload.amount ?? amount),
      phone: payload.phone || phoneNorm,
      reference: payload.reference || null,
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return res.status(500).json({ message: "Transfer failed" });
  }
});

/**
 * POST /wallet/agent-cash-in  (AGENT -> USER)
 * Body: { phone, currency, amount, description, fee }
 */
router.post("/agent-cash-in", authMiddleware, async (req, res) => {
  try {
    const agentId = req.user.userId;

    const agentRole = await getUserRole(agentId);
    if (agentRole !== "agent") {
      return res.status(403).json({ message: "Only agents can cash-in users" });
    }

    const phoneRaw = String(req.body.phone || "").trim();
    const phoneNorm = normalizePhoneSudan(phoneRaw);
    const currency = normalizeCurrency(req.body.currency);
    const amount = Number(req.body.amount);
    const fee = Number(req.body.fee ?? 0);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || !currency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "phone, currency, amount required" });
    }
    if (!Number.isFinite(fee) || fee < 0) {
      return res.status(400).json({ message: "Invalid fee" });
    }

    let customer = await getUserByPhone(phoneRaw);
    if (!customer) customer = await getUserByPhone(phoneNorm);

    if (!customer) return res.status(400).json({ message: "Customer not found" });
    if (customer.id === agentId) return res.status(400).json({ message: "You can't cash-in yourself" });
    if (customer.role !== "user") return res.status(400).json({ message: "Customer must be a user" });

    // Transfer money AGENT -> USER (agent must have balance/float)
    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: agentId,
      p_receiver_phone: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Agent cash-in to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("agent-cash-in RPC error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Cash-in failed" });
    }

    // ledger record (non-blocking is okay, but we'll handle error)
    const { error: opErr } = await supabase.from("agent_operations").insert({
      type: "cash_in",
      agent_user_id: agentId,
      customer_user_id: customer.id,
      currency,
      amount,
      fee,
      description: description || `Cash-in`,
      status: "completed",
    });

    if (opErr) {
      console.error("agent_operations insert error:", opErr);
      // Transfer succeeded; we still return success but warn in logs
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    return res.json({
      message: "Cash-in successful",
      currency,
      amount,
      fee,
      agentUserId: agentId,
      customerUserId: customer.id,
      phone: phoneNorm,
      senderBalance: row?.sender_balance ?? row?.senderBalance ?? null,
      receiverBalance: row?.receiver_balance ?? row?.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("agent-cash-in error:", err);
    return res.status(500).json({ message: "Cash-in failed" });
  }
});

/**
 * POST /wallet/agent-cash-out  (USER -> AGENT)
 * Body: { phone, currency, amount, description, fee }
 * KYC REQUIRED for the USER
 */
router.post("/agent-cash-out", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userRole = await getUserRole(userId);
    if (userRole !== "user") {
      return res.status(403).json({ message: "Only users can cash-out" });
    }

    const okKyc = await requireKycApproved(userId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before cash-out",
      });
    }

    const phoneRaw = String(req.body.phone || "").trim();
    const phoneNorm = normalizePhoneSudan(phoneRaw);
    const currency = normalizeCurrency(req.body.currency);
    const amount = Number(req.body.amount);
    const fee = Number(req.body.fee ?? 0);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || !currency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "phone, currency, amount required" });
    }
    if (!Number.isFinite(fee) || fee < 0) {
      return res.status(400).json({ message: "Invalid fee" });
    }

    let agent = await getUserByPhone(phoneRaw);
    if (!agent) agent = await getUserByPhone(phoneNorm);

    if (!agent) return res.status(400).json({ message: "Agent not found" });
    if (agent.id === userId) return res.status(400).json({ message: "You can't cash-out to yourself" });
    if (agent.role !== "agent") return res.status(400).json({ message: "Receiver must be an agent" });

    // Transfer money USER -> AGENT
    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: userId,
      p_receiver_phone: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Agent cash-out to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("agent-cash-out RPC error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Cash-out failed" });
    }

    const { error: opErr } = await supabase.from("agent_operations").insert({
      type: "cash_out",
      agent_user_id: agent.id,
      customer_user_id: userId,
      currency,
      amount,
      fee,
      description: description || `Cash-out`,
      status: "completed",
    });

    if (opErr) {
      console.error("agent_operations insert error:", opErr);
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    return res.json({
      message: "Cash-out successful",
      currency,
      amount,
      fee,
      agentUserId: agent.id,
      customerUserId: userId,
      phone: phoneNorm,
      senderBalance: row?.sender_balance ?? row?.senderBalance ?? null,
      receiverBalance: row?.receiver_balance ?? row?.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("agent-cash-out error:", err);
    return res.status(500).json({ message: "Cash-out failed" });
  }
});

/**
 * GET /wallet/agent/operations
 * Agent can view their ledger
 */
router.get("/agent/operations", authMiddleware, async (req, res) => {
  try {
    const agentId = req.user.userId;

    const role = await getUserRole(agentId);
    if (role !== "agent") {
      return res.status(403).json({ message: "Only agents can view operations" });
    }

    const { data, error } = await supabase
      .from("agent_operations")
      .select("id, type, currency, amount, fee, description, status, created_at, customer_user_id")
      .eq("agent_user_id", agentId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("agent ops fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch agent operations" });
    }

    return res.json({ operations: data || [] });
  } catch (err) {
    console.error("agent ops crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
