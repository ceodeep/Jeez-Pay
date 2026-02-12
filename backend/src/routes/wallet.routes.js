const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

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
router.get("/balances", async (req, res) => {
  try {
    const userId = req.user.userId;

    // Optional: auto-seed missing currencies for existing users
    // (If you already seeded via SQL, you can remove this loop)
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
router.get("/balance", async (req, res) => {
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
router.get("/history", async (req, res) => {
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
router.post("/credit", async (req, res) => {
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

    // Ensure wallet exists for that user+currency
    const { wallet, error } = await ensureWallet(userId, currency);
    if (error || !wallet) {
      console.error("credit ensureWallet error:", error);
      return res.status(404).json({ message: "Wallet not found" });
    }

    const newBalance = Number(wallet.balance) + numericAmount;

    // Create transaction
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

    // Update balance
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

module.exports = router;
