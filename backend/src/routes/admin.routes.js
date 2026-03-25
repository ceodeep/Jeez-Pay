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

// ---------- helper: normalize phone ----------
function normalizePhone(raw) {
  const p = String(raw || "").trim();
  const digits = p.replace(/\D/g, "");

  if (!digits) return "";

  if (p.startsWith("+")) return "+" + digits;
  return "+" + digits;
}

// ---------- helper: find user by admin identifier ----------
// identifier can be:
// - phone
// - normalized phone
// - wallet_account_number
// - user UUID
async function getUserByAdminIdentifier(identifierRaw) {
  const raw = String(identifierRaw || "").trim();
  const digitsOnly = /^\d+$/.test(raw);

  // 1) Try exact phone
  let { data, error } = await supabase
    .from("users")
    .select("id, phone, role, wallet_account_number, is_active")
    .eq("phone", raw)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  // 2) Try normalized phone
  const normalizedPhone = normalizePhone(raw);
  if (normalizedPhone && normalizedPhone !== raw) {
    const r2 = await supabase
      .from("users")
      .select("id, phone, role, wallet_account_number, is_active")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (r2.error) throw r2.error;
    if (r2.data) return r2.data;
  }

  // 3) Try wallet account number
  if (digitsOnly) {
    const acc = Number(raw);
    if (Number.isSafeInteger(acc)) {
      const r3 = await supabase
        .from("users")
        .select("id, phone, role, wallet_account_number, is_active")
        .eq("wallet_account_number", acc)
        .maybeSingle();

      if (r3.error) throw r3.error;
      if (r3.data) return r3.data;
    }
  }

  // 4) Try UUID as id
  const r4 = await supabase
    .from("users")
    .select("id, phone, role, wallet_account_number, is_active")
    .eq("id", raw)
    .maybeSingle();

  if (r4.error) throw r4.error;
  if (r4.data) return r4.data;

  return null;
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

// =====================================
// GET /admin/users
// Optional query: ?role=user
// =====================================
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
        is_active,
        created_at,
        wallet_account_number,
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
// Body: { identifier, currency, amount, type, description }
// identifier can be wallet_account_number OR phone OR user UUID
// type = "credit" | "debit"
// =====================================
router.post("/wallet/adjust", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can adjust balances" });
    }

    const identifier = String(req.body.identifier || "").trim();
    const currency = String(req.body.currency || "").trim().toUpperCase();
    const type = String(req.body.type || "").trim().toLowerCase();
    const amount = Number(req.body.amount);
    const description =
      String(req.body.description || "").trim() || "Admin balance adjustment";

    if (!identifier || !currency || !type || req.body.amount == null) {
      return res.status(400).json({
        message: "identifier, currency, amount and type are required",
      });
    }

    if (!["credit", "debit"].includes(type)) {
      return res.status(400).json({ message: "type must be 'credit' or 'debit'" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const user = await getUserByAdminIdentifier(identifier);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const userId = user.id;

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
      .insert([
        {
          wallet_id: wallet.id,
          type,
          amount,
          description,
        },
      ])
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
        wallet_account_number: user.wallet_account_number,
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

// =====================================
// GET /admin/dashboard/stats
// =====================================
router.get("/dashboard/stats", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can view dashboard stats" });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      usersRes,
      pendingKycRes,
      txRes,
      suspendedRes,
      agentsRes,
      merchantsRes,
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase
        .from("kyc_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("transactions")
        .select("amount, created_at")
        .gte("created_at", todayStart.toISOString()),
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("is_active", false),
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("role", "agent"),
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("role", "merchant"),
    ]);

    if (usersRes.error) {
      console.error("dashboard stats users error:", usersRes.error);
      return res.status(500).json({ message: "Failed to load dashboard stats" });
    }
    if (pendingKycRes.error) {
      console.error("dashboard stats pending KYC error:", pendingKycRes.error);
      return res.status(500).json({ message: "Failed to load dashboard stats" });
    }
    if (txRes.error) {
      console.error("dashboard stats transactions error:", txRes.error);
      return res.status(500).json({ message: "Failed to load dashboard stats" });
    }
    if (suspendedRes.error) {
      console.error("dashboard stats suspended users error:", suspendedRes.error);
      return res.status(500).json({ message: "Failed to load dashboard stats" });
    }
    if (agentsRes.error) {
      console.error("dashboard stats agents error:", agentsRes.error);
      return res.status(500).json({ message: "Failed to load dashboard stats" });
    }
    if (merchantsRes.error) {
      console.error("dashboard stats merchants error:", merchantsRes.error);
      return res.status(500).json({ message: "Failed to load dashboard stats" });
    }

    const todayTransactions = txRes.data || [];
    const totalVolumeToday = todayTransactions.reduce(
      (sum, tx) => sum + Number(tx.amount || 0),
      0
    );

    return res.json({
      stats: {
        totalUsers: usersRes.count || 0,
        pendingKyc: pendingKycRes.count || 0,
        suspendedUsers: suspendedRes.count || 0,
        totalTransactionsToday: todayTransactions.length,
        totalVolumeToday,
        totalAgents: agentsRes.count || 0,
        totalMerchants: merchantsRes.count || 0,
      },
    });
  } catch (err) {
    console.error("admin/dashboard/stats crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;