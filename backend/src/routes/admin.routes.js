const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const { logAdminAction } = require("../utils/auditLogger");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const { getPermissionsForRole } = require("../config/adminPermissions");

// ---------- helper: admin only ----------


function makeAdminAdjustmentReference() {
  return `ADM-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
// =====================================
// GET /admin/kyc/list
// Optional query params:
// ?status=pending
// ?search=+249...
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// ?limit=100
// =====================================
router.get(
  "/kyc/list",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "").trim().toLowerCase();
      const search = String(req.query.search || "").trim();
      const createdFrom = String(req.query.createdFrom || "").trim();
      const createdTo = String(req.query.createdTo || "").trim();
      const limitRaw = Number(req.query.limit || 100);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 200)
        : 100;

      let userIdFilter = null;

      if (search) {
        const matchedUser = await getUserByAdminIdentifier(search);
        if (!matchedUser) {
          return res.json({ kycs: [] });
        }
        userIdFilter = matchedUser.id;
      }

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
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) {
        query = query.eq("status", status);
      }

      if (userIdFilter) {
        query = query.eq("user_id", userIdFilter);
      }

      if (createdFrom) {
        query = query.gte("created_at", new Date(createdFrom).toISOString());
      }

      if (createdTo) {
        const end = new Date(createdTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
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
  }
);

// =====================================
// POST /admin/kyc/approve
// Body: { userId }
// =====================================
router.post(
  "/kyc/approve",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.approve"),
  async (req, res) => {
  try {
    const adminId = req.user.userId;


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

    const adminInfo = req.adminUser;

    await logAdminAction({
      adminId,
      adminPhone: adminInfo?.phone || null,
      action: "KYC_APPROVED",
      targetType: "kyc",
      targetId: userId,
      targetDisplay: userId,
      oldValue: { status: existing.status },
      newValue: { status: "approved" },
      req,
    });

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
router.post(
  "/kyc/reject",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.reject"),
  async (req, res) => {
  try {
    const adminId = req.user.userId;


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

    const adminInfo = req.adminUser;

    await logAdminAction({
      adminId,
      adminPhone: adminInfo?.phone || null,
      action: "KYC_REJECTED",
      targetType: "kyc",
      targetId: userId,
      targetDisplay: userId,
      oldValue: { status: existing.status },
      newValue: { status: "rejected" },
      req,
    });

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
// =====================================
// GET /admin/users
// Optional query params:
// ?role=user
// ?search=+249...
// ?isActive=true
// ?phoneVerified=true
// ?accountType=personal
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// ?limit=100
// =====================================
router.get(
  "/users",
  authMiddleware,
  requireAdmin,
  requirePermission("users.view"),
  async (req, res) => {
    try {
      const role = String(req.query.role || "").trim().toLowerCase();
      const search = String(req.query.search || "").trim();
      const isActive = String(req.query.isActive || "").trim().toLowerCase();
      const phoneVerified = String(req.query.phoneVerified || "").trim().toLowerCase();
      const accountType = String(req.query.accountType || "").trim().toLowerCase();
      const createdFrom = String(req.query.createdFrom || "").trim();
      const createdTo = String(req.query.createdTo || "").trim();
      const limitRaw = Number(req.query.limit || 100);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 200)
        : 100;

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
        .order("created_at", { ascending: false })
        .limit(limit);

      if (role) {
        query = query.eq("role", role);
      }

      if (accountType) {
        query = query.eq("account_type", accountType);
      }

      if (isActive === "true") {
        query = query.eq("is_active", true);
      } else if (isActive === "false") {
        query = query.eq("is_active", false);
      }

      if (phoneVerified === "true") {
        query = query.eq("phone_verified", true);
      } else if (phoneVerified === "false") {
        query = query.eq("phone_verified", false);
      }

      if (createdFrom) {
        query = query.gte("created_at", new Date(createdFrom).toISOString());
      }

      if (createdTo) {
        const end = new Date(createdTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }

      if (search) {
        const normalized = normalizePhone(search);
        const searchDigitsOnly = /^\d+$/.test(search);

        if (searchDigitsOnly) {
          const acc = Number(search);
          if (Number.isSafeInteger(acc)) {
            query = query.or(
              `phone.ilike.%${search}%,phone.ilike.%${normalized}%,wallet_account_number.eq.${acc},id.eq.${search}`
            );
          } else {
            query = query.or(
              `phone.ilike.%${search}%,phone.ilike.%${normalized}%,id.eq.${search}`
            );
          }
        } else {
          query = query.or(
            `phone.ilike.%${search}%,phone.ilike.%${normalized}%,id.eq.${search}`
          );
        }
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
  }
);

// =====================================
// POST /admin/user/suspend
// Body: { userId }
// =====================================
router.post(
  "/user/suspend",
  authMiddleware,
  requireAdmin,
  requirePermission("users.suspend"),
  async (req, res) => {
  try {
    const adminId = req.user.userId;

    

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

    const adminInfo = req.adminUser;

    await logAdminAction({
      adminId,
      adminPhone: adminInfo?.phone || null,
      action: "USER_SUSPENDED",
      targetType: "user",
      targetId: userId,
      targetDisplay: existing.phone,
      oldValue: {
        is_active: existing.is_active,
        role: existing.role,
      },
      newValue: {
        is_active: false,
        role: existing.role,
      },
      req,
    });

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
// =====================================
// GET /admin/transactions
// Optional query params:
// ?currency=USDT
// ?type=credit
// ?reference=ADM-...
// ?search=+249...
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// ?minAmount=10
// ?maxAmount=500
// ?limit=100
// =====================================
router.get(
  "/transactions",
  authMiddleware,
  requireAdmin,
  requirePermission("transactions.view"),
  async (req, res) => {
    try {
      const currency = String(req.query.currency || "").trim().toUpperCase();
      const type = String(req.query.type || "").trim().toLowerCase();
      const reference = String(req.query.reference || "").trim();
      const search = String(req.query.search || "").trim();
      const createdFrom = String(req.query.createdFrom || "").trim();
      const createdTo = String(req.query.createdTo || "").trim();
      const minAmount = Number(req.query.minAmount);
      const maxAmount = Number(req.query.maxAmount);
      const limitRaw = Number(req.query.limit || 100);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 200)
        : 100;

      let userIdFilter = null;

      if (search) {
        const matchedUser = await getUserByAdminIdentifier(search);
        if (matchedUser) {
          userIdFilter = matchedUser.id;
        }
      }

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
          wallets!inner (
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

      if (reference) {
        query = query.ilike("reference", `%${reference}%`);
      }

      if (createdFrom) {
        query = query.gte("created_at", new Date(createdFrom).toISOString());
      }

      if (createdTo) {
        const end = new Date(createdTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }

      if (Number.isFinite(minAmount)) {
        query = query.gte("amount", minAmount);
      }

      if (Number.isFinite(maxAmount)) {
        query = query.lte("amount", maxAmount);
      }

      if (userIdFilter) {
        query = query.eq("wallets.user_id", userIdFilter);
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
  }
);

// =====================================
// POST /admin/user/activate
// Body: { userId }
// =====================================
router.post(
  "/user/activate",
  authMiddleware,
  requireAdmin,
  requirePermission("users.activate"),
  async (req, res) => {
  try {
    const adminId = req.user.userId;


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

    const adminInfo = req.adminUser;

    await logAdminAction({
      adminId,
      adminPhone: adminInfo?.phone || null,
      action: "USER_ACTIVATED",
      targetType: "user",
      targetId: userId,
      targetDisplay: existing.phone,
      oldValue: {
        is_active: existing.is_active,
        role: existing.role,
      },
      newValue: {
        is_active: true,
        role: existing.role,
      },
      req,
    });

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
router.post(
  "/wallet/adjust",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;

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

      if (!user.is_active) {
        return res.status(400).json({ message: "Cannot adjust wallet for suspended user" });
      }

      if (user.role === "admin" || user.role === "super_admin") {
        return res.status(403).json({ message: "Admin wallets cannot be adjusted from this endpoint" });
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
      let walletCreatedNow = false;

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
        walletCreatedNow = true;
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

      const reference = makeAdminAdjustmentReference();

      const { data: tx, error: txErr } = await supabase
        .from("transactions")
        .insert([
          {
            wallet_id: wallet.id,
            type,
            amount,
            description,
            reference,
          },
        ])
        .select()
        .single();

      if (txErr) {
        console.error("admin/wallet/adjust transaction insert error:", txErr);

        // rollback wallet balance
        const { error: rollbackErr } = await supabase
          .from("wallets")
          .update({ balance: currentBalance })
          .eq("id", wallet.id);

        if (rollbackErr) {
          console.error("admin/wallet/adjust rollback error:", rollbackErr);
          return res.status(500).json({
            message: "Transaction failed and wallet rollback also failed. Manual review required",
          });
        }

        // optional cleanup: remove newly-created empty wallet
        if (walletCreatedNow) {
          await supabase
            .from("wallets")
            .delete()
            .eq("id", wallet.id)
            .eq("balance", currentBalance);
        }

        return res.status(500).json({
          message: "Transaction failed, balance rolled back",
        });
      }

      const adminInfo = req.adminUser;

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "WALLET_ADJUSTED",
        targetType: "wallet",
        targetId: wallet.id,
        targetDisplay: user.phone || String(user.wallet_account_number || user.id),
        oldValue: {
          currency,
          balance: currentBalance,
        },
        newValue: {
          currency,
          balance: newBalance,
          adjustmentType: type,
          amount,
          description,
          transactionId: tx.id,
          reference,
        },
        req,
      });

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
  }
);

// =====================================
// GET /admin/wallets/view
// Query: ?identifier=+249xxxx OR wallet_account_number OR user UUID
// Returns all wallets for one user + summary
// =====================================
router.get(
  "/wallets/view",
  authMiddleware,
  requireAdmin,
  requirePermission("users.view"),
  async (req, res) => {
    try {
      const identifier = String(req.query.identifier || "").trim();

      if (!identifier) {
        return res.status(400).json({ message: "identifier is required" });
      }

      const user = await getUserByAdminIdentifier(identifier);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { data: wallets, error: walletsErr } = await supabase
        .from("wallets")
        .select(`
          id,
          user_id,
          currency,
          balance
        `)
        .eq("user_id", user.id)
        .order("currency", { ascending: true });

      if (walletsErr) {
        console.error("admin/wallets/view wallets error:", walletsErr);
        return res.status(500).json({ message: "Failed to fetch wallets" });
      }

      const safeWallets = (wallets || []).map((wallet) => ({
        id: wallet.id,
        user_id: wallet.user_id,
        currency: wallet.currency,
        current_balance: Number(wallet.balance || 0),
        available_balance: Number(wallet.balance || 0),
        frozen_balance: 0,
        pending_withdrawals: 0,
      }));

      const summary = {
        wallet_count: safeWallets.length,
        total_current_balance: safeWallets.reduce(
          (sum, wallet) => sum + Number(wallet.current_balance || 0),
          0
        ),
        total_available_balance: safeWallets.reduce(
          (sum, wallet) => sum + Number(wallet.available_balance || 0),
          0
        ),
        total_frozen_balance: safeWallets.reduce(
          (sum, wallet) => sum + Number(wallet.frozen_balance || 0),
          0
        ),
        total_pending_withdrawals: safeWallets.reduce(
          (sum, wallet) => sum + Number(wallet.pending_withdrawals || 0),
          0
        ),
      };

      return res.json({
        user: {
          id: user.id,
          phone: user.phone,
          role: user.role,
          wallet_account_number: user.wallet_account_number,
          is_active: user.is_active,
        },
        wallets: safeWallets,
        summary,
      });
    } catch (err) {
      console.error("admin/wallets/view crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/user/details
// Query: ?identifier=+249xxxx OR wallet_account_number OR user UUID
// Returns deep user profile for admin panel
// =====================================
router.get(
  "/user/details",
  authMiddleware,
  requireAdmin,
  requirePermission("users.view"),
  async (req, res) => {
    try {
      const identifier = String(req.query.identifier || "").trim();

      if (!identifier) {
        return res.status(400).json({ message: "identifier is required" });
      }

      const user = await getUserByAdminIdentifier(identifier);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = user.id;

      const [
        userRes,
        walletsRes,
        kycRes,
        txRes,
      ] = await Promise.all([
        supabase
          .from("users")
          .select(`
            id,
            phone,
            role,
            account_type,
            phone_verified,
            is_active,
            created_at,
            wallet_account_number
          `)
          .eq("id", userId)
          .maybeSingle(),

        supabase
          .from("wallets")
          .select(`
            id,
            user_id,
            currency,
            balance
          `)
          .eq("user_id", userId)
          .order("currency", { ascending: true }),

        supabase
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
          .eq("user_id", userId)
          .maybeSingle(),

        supabase
          .from("transactions")
          .select(`
            id,
            wallet_id,
            type,
            amount,
            description,
            reference,
            created_at,
            wallets!inner (
              user_id,
              currency
            )
          `)
          .eq("wallets.user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (userRes.error) {
        console.error("admin/user/details user error:", userRes.error);
        return res.status(500).json({ message: "Failed to fetch user profile" });
      }

      if (walletsRes.error) {
        console.error("admin/user/details wallets error:", walletsRes.error);
        return res.status(500).json({ message: "Failed to fetch user wallets" });
      }

      if (kycRes.error) {
        console.error("admin/user/details kyc error:", kycRes.error);
        return res.status(500).json({ message: "Failed to fetch user KYC" });
      }

      if (txRes.error) {
        console.error("admin/user/details transactions error:", txRes.error);
        return res.status(500).json({ message: "Failed to fetch user transactions" });
      }

      const profile = userRes.data;
      if (!profile) {
        return res.status(404).json({ message: "User not found" });
      }

      const wallets = (walletsRes.data || []).map((wallet) => ({
        id: wallet.id,
        user_id: wallet.user_id,
        currency: wallet.currency,
        current_balance: Number(wallet.balance || 0),
        available_balance: Number(wallet.balance || 0),
        frozen_balance: 0,
        pending_withdrawals: 0,
      }));

      const walletSummary = {
        wallet_count: wallets.length,
        total_current_balance: wallets.reduce(
          (sum, wallet) => sum + Number(wallet.current_balance || 0),
          0
        ),
        total_available_balance: wallets.reduce(
          (sum, wallet) => sum + Number(wallet.available_balance || 0),
          0
        ),
        total_frozen_balance: wallets.reduce(
          (sum, wallet) => sum + Number(wallet.frozen_balance || 0),
          0
        ),
        total_pending_withdrawals: wallets.reduce(
          (sum, wallet) => sum + Number(wallet.pending_withdrawals || 0),
          0
        ),
      };

      const recentTransactions = (txRes.data || []).map((tx) => ({
        id: tx.id,
        wallet_id: tx.wallet_id,
        type: tx.type,
        amount: Number(tx.amount || 0),
        description: tx.description,
        reference: tx.reference,
        created_at: tx.created_at,
        currency: tx.wallets?.currency || null,
      }));

      return res.json({
        user: profile,
        wallets,
        walletSummary,
        kyc: kycRes.data || null,
        recentTransactions,
      });
    } catch (err) {
      console.error("admin/user/details crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/dashboard/stats
// =====================================
// =====================================
// GET /admin/dashboard/stats
// =====================================


router.get(
  "/dashboard/stats",
  authMiddleware,
  requireAdmin,
  requirePermission("dashboard.view"),
  async (req, res) => {
    try {
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
  }
);

// =====================================
// GET /admin/audit-logs
// Optional query params:
//   ?action=KYC_APPROVED
//   ?adminId=uuid
//   ?targetType=user
//   ?limit=100
// =====================================
// =====================================
// GET /admin/audit-logs
// Optional query params:
// ?action=KYC_APPROVED
// ?adminId=uuid
// ?targetType=user
// ?targetId=uuid
// ?search=+249...
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// ?limit=100
// =====================================
router.get(
  "/audit-logs",
  authMiddleware,
  requireAdmin,
  requirePermission("audit_logs.view"),
  async (req, res) => {
    try {
      const action = String(req.query.action || "").trim();
      const targetType = String(req.query.targetType || "").trim();
      const filterAdminId = String(req.query.adminId || "").trim();
      const targetId = String(req.query.targetId || "").trim();
      const search = String(req.query.search || "").trim();
      const createdFrom = String(req.query.createdFrom || "").trim();
      const createdTo = String(req.query.createdTo || "").trim();
      const limitRaw = Number(req.query.limit || 100);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 200)
        : 100;

      let query = supabase
        .from("audit_logs")
        .select(`
          id,
          admin_id,
          admin_phone,
          action,
          target_type,
          target_id,
          target_display,
          old_value,
          new_value,
          ip_address,
          user_agent,
          created_at
        `)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (action) query = query.eq("action", action);
      if (targetType) query = query.eq("target_type", targetType);
      if (filterAdminId) query = query.eq("admin_id", filterAdminId);
      if (targetId) query = query.eq("target_id", targetId);

      if (createdFrom) {
        query = query.gte("created_at", new Date(createdFrom).toISOString());
      }

      if (createdTo) {
        const end = new Date(createdTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }

      if (search) {
        query = query.or(
          `admin_phone.ilike.%${search}%,target_display.ilike.%${search}%,target_id.eq.${search}`
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error("admin/audit-logs error:", error);
        return res.status(500).json({ message: "Failed to fetch audit logs" });
      }

      return res.json({
        logs: data || [],
      });
    } catch (err) {
      console.error("admin/audit-logs crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/me/permissions
// Returns current admin profile + role + permissions
// =====================================
router.get(
  "/me/permissions",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const adminUser = req.adminUser;
      const permissions = getPermissionsForRole(adminUser.role);

      return res.json({
        admin: {
          id: adminUser.id,
          phone: adminUser.phone,
          role: adminUser.role,
          is_active: adminUser.is_active,
        },
        permissions,
        isSuperAdmin: permissions.includes("*"),
      });
    } catch (err) {
      console.error("admin/me/permissions crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// POST /admin/user/set-role
// Body: { userId, role }
// =====================================
router.post(
  "/user/set-role",
  authMiddleware,
  requireAdmin,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const { userId, role } = req.body;

      const allowedRoles = [
        "admin",
        "super_admin",
        "finance_admin",
        "kyc_officer",
        "support_agent",
        "auditor",
        "user",
      ];
      

      if (!userId || !role) {
        return res.status(400).json({ message: "userId and role are required" });
      }

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      // fetch current user
      const { data: existing, error: fetchErr } = await supabase
        .from("users")
        .select("id, phone, role")
        .eq("id", userId)
        .maybeSingle();

      if (fetchErr) {
        console.error("set-role lookup error:", fetchErr);
        return res.status(500).json({ message: "User lookup failed" });
      }

      if (!existing) {
        return res.status(404).json({ message: "User not found" });
      }

      if (existing && existing.role === role) {
  return res.status(400).json({ message: "User already has this role" });
}

      // prevent self downgrade
      if (userId === adminId) {
        return res.status(400).json({ message: "Cannot change your own role" });
      }

      const { data, error } = await supabase
        .from("users")
        .update({ role })
        .eq("id", userId)
        .select("id, phone, role")
        .single();

      if (error) {
        console.error("set-role update error:", error);
        return res.status(500).json({ message: "Failed to update role" });
      }

      // audit log
      const adminInfo = req.adminUser;

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "USER_ROLE_CHANGED",
        targetType: "user",
        targetId: userId,
        targetDisplay: existing.phone,
        oldValue: { role: existing.role },
        newValue: { role },
        req,
      });

      return res.json({
        message: "Role updated successfully",
        user: data,
      });
    } catch (err) {
      console.error("set-role crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

function requireSuperAdmin(req, res, next) {
  const adminUser = req.adminUser;

  if (!adminUser) {
    return res.status(403).json({ message: "Admin context missing" });
  }

  if (adminUser.role !== "super_admin") {
    return res.status(403).json({
      message: "Only super admin can perform this action",
    });
  }

  next();
}

// =====================================
// GET /admin/settings
// Returns current system settings
// =====================================
router.get(
  "/settings",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.view"),
  async (req, res) => {
    try {
      let { data, error } = await supabase
        .from("system_settings")
        .select(`
          id,
          transfer_fee_percent,
          daily_transfer_limit,
          kyc_required,
          maintenance_mode,
          supported_currencies,
          updated_at
        `)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("admin/settings GET error:", error);
        return res.status(500).json({ message: "Failed to fetch settings" });
      }

      if (!data) {
        const seed = {
          transfer_fee_percent: 0,
          daily_transfer_limit: 0,
          kyc_required: true,
          maintenance_mode: false,
          supported_currencies: ["USDT", "SSP", "SDG", "EGP", "UGX"],
          updated_at: new Date().toISOString(),
        };

        const inserted = await supabase
          .from("system_settings")
          .insert([seed])
          .select(`
            id,
            transfer_fee_percent,
            daily_transfer_limit,
            kyc_required,
            maintenance_mode,
            supported_currencies,
            updated_at
          `)
          .single();

        if (inserted.error) {
          console.error("admin/settings seed error:", inserted.error);
          return res.status(500).json({ message: "Failed to initialize settings" });
        }

        data = inserted.data;
      }

      return res.json({
        settings: {
          id: data.id,
          transferFeePercent: Number(data.transfer_fee_percent || 0),
          dailyTransferLimit: Number(data.daily_transfer_limit || 0),
          kycRequired: Boolean(data.kyc_required),
          maintenanceMode: Boolean(data.maintenance_mode),
          supportedCurrencies: Array.isArray(data.supported_currencies)
            ? data.supported_currencies
            : [],
          updatedAt: data.updated_at,
        },
      });
    } catch (err) {
      console.error("admin/settings GET crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// POST /admin/settings
// Body: {
//   transferFeePercent,
//   dailyTransferLimit,
//   kycRequired,
//   maintenanceMode,
//   supportedCurrencies
// }
// =====================================
router.post(
  "/settings",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.update"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;

      const transferFeePercent = Number(req.body.transferFeePercent ?? 0);
      const dailyTransferLimit = Number(req.body.dailyTransferLimit ?? 0);
      const kycRequired = Boolean(req.body.kycRequired);
      const maintenanceMode = Boolean(req.body.maintenanceMode);
      const supportedCurrenciesRaw = Array.isArray(req.body.supportedCurrencies)
        ? req.body.supportedCurrencies
        : [];

      const supportedCurrencies = supportedCurrenciesRaw
        .map((x) => String(x || "").trim().toUpperCase())
        .filter(Boolean);

      if (!Number.isFinite(transferFeePercent) || transferFeePercent < 0) {
        return res.status(400).json({ message: "transferFeePercent must be a valid non-negative number" });
      }

      if (!Number.isFinite(dailyTransferLimit) || dailyTransferLimit < 0) {
        return res.status(400).json({ message: "dailyTransferLimit must be a valid non-negative number" });
      }

      if (supportedCurrencies.length === 0) {
        return res.status(400).json({ message: "At least one supported currency is required" });
      }

      const currentRes = await supabase
        .from("system_settings")
        .select(`
          id,
          transfer_fee_percent,
          daily_transfer_limit,
          kyc_required,
          maintenance_mode,
          supported_currencies,
          updated_at
        `)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (currentRes.error) {
        console.error("admin/settings current lookup error:", currentRes.error);
        return res.status(500).json({ message: "Failed to load current settings" });
      }

      const oldSettings = currentRes.data
        ? {
            transferFeePercent: Number(currentRes.data.transfer_fee_percent || 0),
            dailyTransferLimit: Number(currentRes.data.daily_transfer_limit || 0),
            kycRequired: Boolean(currentRes.data.kyc_required),
            maintenanceMode: Boolean(currentRes.data.maintenance_mode),
            supportedCurrencies: Array.isArray(currentRes.data.supported_currencies)
              ? currentRes.data.supported_currencies
              : [],
            updatedAt: currentRes.data.updated_at,
          }
        : null;

      const payload = {
        transfer_fee_percent: transferFeePercent,
        daily_transfer_limit: dailyTransferLimit,
        kyc_required: kycRequired,
        maintenance_mode: maintenanceMode,
        supported_currencies: supportedCurrencies,
        updated_at: new Date().toISOString(),
      };

      let saved;

      if (!currentRes.data) {
        const insertRes = await supabase
          .from("system_settings")
          .insert([payload])
          .select(`
            id,
            transfer_fee_percent,
            daily_transfer_limit,
            kyc_required,
            maintenance_mode,
            supported_currencies,
            updated_at
          `)
          .single();

        if (insertRes.error) {
          console.error("admin/settings insert error:", insertRes.error);
          return res.status(500).json({ message: "Failed to save settings" });
        }

        saved = insertRes.data;
      } else {
        const updateRes = await supabase
          .from("system_settings")
          .update(payload)
          .eq("id", currentRes.data.id)
          .select(`
            id,
            transfer_fee_percent,
            daily_transfer_limit,
            kyc_required,
            maintenance_mode,
            supported_currencies,
            updated_at
          `)
          .single();

        if (updateRes.error) {
          console.error("admin/settings update error:", updateRes.error);
          return res.status(500).json({ message: "Failed to update settings" });
        }

        saved = updateRes.data;
      }

      const newSettings = {
        transferFeePercent: Number(saved.transfer_fee_percent || 0),
        dailyTransferLimit: Number(saved.daily_transfer_limit || 0),
        kycRequired: Boolean(saved.kyc_required),
        maintenanceMode: Boolean(saved.maintenance_mode),
        supportedCurrencies: Array.isArray(saved.supported_currencies)
          ? saved.supported_currencies
          : [],
        updatedAt: saved.updated_at,
      };

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "SYSTEM_SETTINGS_UPDATED",
        targetType: "system_settings",
        targetId: saved.id,
        targetDisplay: "system_settings",
        oldValue: oldSettings,
        newValue: newSettings,
        req,
      });

      return res.json({
        message: "Settings updated successfully",
        settings: newSettings,
      });
    } catch (err) {
      console.error("admin/settings POST crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);



module.exports = router;