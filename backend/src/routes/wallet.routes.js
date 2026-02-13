const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");

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

/**
 * GET /wallet/balances
 * Returns all balances for the logged-in user
 * Response: { balances: [{currency, balance}] }
 */
router.get("/balances", authMiddleware, async (req, res) => {
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
      console.error("balances fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch balances" });
    }

    return res.json({ balances: data || [] });
  } catch (err) {
    console.error("balances crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /wallet/balance?currency=USDT
 * (Optional helper) Returns one currency balance
 */
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currency = normalizeCurrency(req.query.currency || "USDT");

    const { wallet, error } = await ensureWallet(userId, currency);
    if (error) {
      console.error("balance ensureWallet error:", error);
      return res.status(500).json({ message: "Failed to fetch wallet" });
    }

    return res.json({ currency: wallet.currency, balance: wallet.balance });
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
      return res
        .status(400)
        .json({ message: "Amount must be a positive number" });
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

// POST /wallet/transfer
// Body: { phone, currency, amount, description }
router.post("/transfer", authMiddleware, async (req, res) => {
  try {
    const senderId = req.user.userId;

    const phoneRaw = req.body.phone;
    const amountRaw = req.body.amount;
    const currency = normalizeCurrency(req.body.currency);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || amountRaw == null || !currency) {
      return res.status(400).json({ message: "phone, amount, currency required" });
    }

    const phoneRawClean = String(phoneRaw || "").trim();
    const phoneNorm = normalizePhoneSudan(phoneRawClean);

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // 1) Resolve receiver user by phone (try raw then normalized)
    let receiverUser = null;

    const { data: u1, error: e1 } = await supabase
      .from("users")
      .select("id, phone")
      .eq("phone", phoneRawClean)
      .maybeSingle();

    if (e1) {
      console.error("Receiver lookup error (raw):", e1);
      return res.status(500).json({ message: "Receiver lookup failed" });
    }
    receiverUser = u1;

    if (!receiverUser) {
      const { data: u2, error: e2 } = await supabase
        .from("users")
        .select("id, phone")
        .eq("phone", phoneNorm)
        .maybeSingle();

      if (e2) {
        console.error("Receiver lookup error (normalized):", e2);
        return res.status(500).json({ message: "Receiver lookup failed" });
      }
      receiverUser = u2;
    }

    if (!receiverUser) {
      return res.status(400).json({ message: "Receiver not found" });
    }

    if (receiverUser.id === senderId) {
      return res.status(400).json({ code: "SELF_TRANSFER", message: "You can't send money to your own account" });
    }

    // 2) Call RPC (atomic transfer inside Postgres)
    // This replaces: sender/receiver balance updates + tx inserts
    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: senderId,
      p_receiver_phone: phoneNorm,
      p_currency: currency,
      p_amount: amount,
      // keep description stable; if null, RPC can generate defaults
      p_description: description || `Sent to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("RPC transfer error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Transfer failed" });
    }

    // Some RPCs return an object, others return an array with one row
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    return res.json({
      message: "Transfer successful",
      currency,
      amount,
      fromUserId: senderId,
      toUserId: receiverUser.id,
      phone: phoneNorm,
      // If your RPC returns balances, expose them; otherwise null is fine
      senderBalance: row?.sender_balance ?? row?.senderBalance ?? null,
      receiverBalance: row?.receiver_balance ?? row?.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return res.status(500).json({ message: "Transfer failed" });
  }
});

module.exports = router;
