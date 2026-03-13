const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");

// ---------- helper: admin only ----------
async function isAdmin(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;
  return data.role === "admin";
}

// =====================================
// GET /admin/kyc/list
// List KYC submissions
// Optional query: ?status=pending
// =====================================
router.get("/kyc/list", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can view KYC submissions" });
    }

    const status = String(req.query.status || "").trim().toLowerCase();

    let query = supabase
      .from("kyc_profiles")
      .select(`
        user_id,
        full_name,
        dob,
        address,
        id_path,
        selfie_path,
        status,
        created_at,
        updated_at
      `)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("admin/kyc/list error:", error);
      return res.status(500).json({ message: "Failed to fetch KYC submissions" });
    }

    return res.json({
      kycs: data || [],
    });
  } catch (err) {
    console.error("admin/kyc/list crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// POST /admin/kyc/approve
// Body: { userId }
// =====================================
router.post("/kyc/approve", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can approve KYC" });
    }

    const userId = String(req.body.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("kyc_profiles")
      .select("user_id, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("admin/kyc/approve lookup error:", fetchErr);
      return res.status(500).json({ message: "KYC lookup failed" });
    }

    if (!existing) {
      return res.status(404).json({ message: "KYC record not found" });
    }

    const { data, error } = await supabase
      .from("kyc_profiles")
      .update({
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("admin/kyc/approve update error:", error);
      return res.status(500).json({ message: "Failed to approve KYC" });
    }

    return res.json({
      message: "KYC approved successfully",
      kyc: data,
    });
  } catch (err) {
    console.error("admin/kyc/approve crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// POST /admin/kyc/reject
// Body: { userId }
// =====================================
router.post("/kyc/reject", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can reject KYC" });
    }

    const userId = String(req.body.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("kyc_profiles")
      .select("user_id, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("admin/kyc/reject lookup error:", fetchErr);
      return res.status(500).json({ message: "KYC lookup failed" });
    }

    if (!existing) {
      return res.status(404).json({ message: "KYC record not found" });
    }

    const { data, error } = await supabase
      .from("kyc_profiles")
      .update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("admin/kyc/reject update error:", error);
      return res.status(500).json({ message: "Failed to reject KYC" });
    }

    return res.json({
      message: "KYC rejected successfully",
      kyc: data,
    });
  } catch (err) {
    console.error("admin/kyc/reject crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/users", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can view users" });
    }

    const role = String(req.query.role || "").trim().toLowerCase();

    let query = supabase
      .from("users")
      .select(`
        id,
        phone,
        role,
        account_type,
        phone_verified,
        created_at,
        kyc_profiles (
          status
        )
      `)
      .order("created_at", { ascending: false });

    if (role) {
      query = query.eq("role", role);
    }

    const { data, error } = await query;

    if (error) {
      console.error("admin/users error:", error);
      return res.status(500).json({ message: "Failed to fetch users" });
    }

    return res.json({
      users: data || [],
    });
  } catch (err) {
    console.error("admin/users crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// POST /admin/user/suspend
// Body: { userId }
// =====================================
router.post("/user/suspend", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can suspend users" });
    }

    const userId = String(req.body.userId || "").trim();
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    if (userId === adminId) {
      return res.status(400).json({ message: "Admin cannot suspend self" });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone, role, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("admin/user/suspend lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!existing) {
      return res.status(404).json({ message: "User not found" });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ is_active: false })
      .eq("id", userId)
      .select("id, phone, role, is_active")
      .single();

    if (error) {
      console.error("admin/user/suspend update error:", error);
      return res.status(500).json({ message: "Failed to suspend user" });
    }

    return res.json({
      message: "User suspended successfully",
      user: data,
    });
  } catch (err) {
    console.error("admin/user/suspend crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// GET /admin/transactions
// Optional query params:
//   ?currency=USDT
//   ?type=credit
//   ?limit=100
// =====================================
router.get("/transactions", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can view transactions" });
    }

    const currency = String(req.query.currency || "").trim().toUpperCase();
    const type = String(req.query.type || "").trim().toLowerCase();
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : 100;

    let query = supabase
      .from("transactions")
      .select(`
        id,
        wallet_id,
        type,
        amount,
        description,
        reference,
        created_at,
        wallets (
          user_id,
          currency
        )
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq("type", type);
    }

    if (currency) {
      query = query.eq("wallets.currency", currency);
    }

    const { data, error } = await query;

    if (error) {
      console.error("admin/transactions error:", error);
      return res.status(500).json({ message: "Failed to fetch transactions" });
    }

    return res.json({
      transactions: data || [],
    });
  } catch (err) {
    console.error("admin/transactions crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// POST /admin/user/activate
// Body: { userId }
// =====================================
router.post("/user/activate", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can activate users" });
    }

    const userId = String(req.body.userId || "").trim();
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone, role, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("admin/user/activate lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!existing) {
      return res.status(404).json({ message: "User not found" });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ is_active: true })
      .eq("id", userId)
      .select("id, phone, role, is_active")
      .single();

    if (error) {
      console.error("admin/user/activate update error:", error);
      return res.status(500).json({ message: "Failed to activate user" });
    }

    return res.json({
      message: "User activated successfully",
      user: data,
    });
  } catch (err) {
    console.error("admin/user/activate crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// POST /admin/wallet/adjust
// Body: { userId, currency, amount, type, description }
// type = "credit" | "debit"
// =====================================
router.post("/wallet/adjust", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can adjust balances" });
    }

    const userId = String(req.body.userId || "").trim();
    const currency = String(req.body.currency || "").trim().toUpperCase();
    const type = String(req.body.type || "").trim().toLowerCase();
    const amount = Number(req.body.amount);
    const description = String(req.body.description || "").trim() || "Admin balance adjustment";

    if (!userId || !currency || !type || req.body.amount == null) {
      return res.status(400).json({
        message: "userId, currency, amount and type are required",
      });
    }

    if (!["credit", "debit"].includes(type)) {
      return res.status(400).json({ message: "type must be 'credit' or 'debit'" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, phone, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (userErr) {
      console.error("admin/wallet/adjust user lookup error:", userErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ensure wallet exists
    const { data: walletExisting, error: walletFetchErr } = await supabase
      .from("wallets")
      .select("id, balance, currency")
      .eq("user_id", userId)
      .eq("currency", currency)
      .maybeSingle();

    if (walletFetchErr) {
      console.error("admin/wallet/adjust wallet lookup error:", walletFetchErr);
      return res.status(500).json({ message: "Wallet lookup failed" });
    }

    let wallet = walletExisting;

    if (!wallet) {
      const { data: createdWallet, error: createWalletErr } = await supabase
        .from("wallets")
        .insert([{ user_id: userId, currency, balance: 0 }])
        .select("id, balance, currency")
        .single();

      if (createWalletErr) {
        console.error("admin/wallet/adjust wallet create error:", createWalletErr);
        return res.status(500).json({ message: "Failed to create wallet" });
      }

      wallet = createdWallet;
    }

    const currentBalance = Number(wallet.balance || 0);
    let newBalance = currentBalance;

    if (type === "credit") {
      newBalance = currentBalance + amount;
    } else {
      if (currentBalance < amount) {
        return res.status(400).json({ message: "Insufficient balance for debit adjustment" });
      }
      newBalance = currentBalance - amount;
    }

    const { error: updateErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (updateErr) {
      console.error("admin/wallet/adjust wallet update error:", updateErr);
      return res.status(500).json({ message: "Failed to update wallet balance" });
    }

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert([{
        wallet_id: wallet.id,
        type,
        amount,
        description,
      }])
      .select()
      .single();

    if (txErr) {
      console.error("admin/wallet/adjust transaction insert error:", txErr);
      return res.status(500).json({ message: "Balance changed but transaction record failed" });
    }

    return res.json({
      message: `Wallet ${type} successful`,
      user: {
        id: user.id,
        phone: user.phone,
      },
      wallet: {
        id: wallet.id,
        currency,
        previousBalance: currentBalance,
        newBalance,
      },
      transaction: tx,
    });
  } catch (err) {
    console.error("admin/wallet/adjust crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;