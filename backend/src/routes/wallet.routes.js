const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

// GET /wallet/balance
router.get("/balance", async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: wallet, error } = await supabase
      .from("wallets")
      .select("balance, id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error(error);
      return res.status(500).json({ message: "Failed to fetch wallet" });
    }

    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    res.json({ balance: wallet.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /wallet/history
router.get("/history", async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (walletErr || !wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const { data: txs, error } = await supabase
      .from("transactions")
      .select("type, amount, description, created_at")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).json({ message: "Failed to fetch transactions" });
    }

    res.json({ transactions: txs || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /wallet/credit  (admin action)
router.post("/credit", async (req, res) => {
  try {
    const { userId, amount, description } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ message: "userId and amount required" });
    }

    // Find user's wallet
    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (walletErr || !wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const newBalance = wallet.balance + Number(amount);

    // Insert transaction
    const { error: txErr } = await supabase
      .from("transactions")
      .insert({
        wallet_id: wallet.id,
        type: "credit",
        amount: Number(amount),
        description: description || "Admin top-up",
      });

    if (txErr) {
      console.error(txErr);
      return res.status(500).json({ message: "Transaction failed" });
    }

    // Update wallet balance
    const { error: updateErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (updateErr) {
      console.error(updateErr);
      return res.status(500).json({ message: "Balance update failed" });
    }

    res.json({
      message: "Wallet credited",
      newBalance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;