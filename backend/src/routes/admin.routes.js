const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const { logAdminAction } = require("../utils/auditLogger");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const {
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  MANAGEABLE_ROLES,
  getPermissionsForRole,
} = require("../config/adminPermissions");
const { getUsdtScannerStatus } = require("../jobs/usdtDepositScanner.job");

const PROTECTED_ADMIN_ROLES = [
  "admin",
  "super_admin",
  "finance_admin",
  "kyc_officer",
  "support_agent",
  "auditor",
];
const {
  sendUsdtTrc20FromPrivateKey,
  waitForTransactionSuccess,
} = require("../services/tron.service");
const {
  sendUsdtBep20FromPrivateKey,
} = require("../services/bsc.service");
const {
  sweepCreditedUsdtDeposits,
} = require("../services/usdtSweep.service");
const {
  sweepCreditedBep20Deposits,
} = require("../services/usdtBep20Sweep.service");

const {
  scanUsdtBep20Deposits,
} = require("../services/usdtBep20Scanner.service");
const { rentTronEnergy } = require("../services/tronmax.service");

function isProtectedAdminRole(role) {
  return PROTECTED_ADMIN_ROLES.includes(String(role || "").trim());
}

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

async function toKycSignedUrl(path) {
  if (!path) return null;

  const raw = String(path).trim();

  if (!raw) return null;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  const { data, error } = await supabase.storage
    .from("kyc-documents")
    .createSignedUrl(raw, 60 * 10); // 10 minutes

  if (error) {
    console.error("kyc signed url error:", error);
    return null;
  }

  return data?.signedUrl || null;
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
          fullName,
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

      const kycsWithUrls = await Promise.all(
        (data || []).map(async (item) => ({
          ...item,
          id_path: await toKycSignedUrl(item.id_path),
          selfie_path: await toKycSignedUrl(item.selfie_path),
        }))
      );

      return res.json({
        kycs: kycsWithUrls,
      });
    } catch (err) {
      console.error("admin/kyc/list crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

async function processReferralRewardOnKycApproved({ refereeUserId, adminId, req }) {
  const { data: settings, error: settingsErr } = await supabase
    .from("referral_reward_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (settingsErr) throw settingsErr;

  if (!settings || !settings.enabled) {
    return { status: "skipped", reason: "referral rewards disabled" };
  }

  if (settings.trigger_event !== "kyc_approved") {
    return { status: "skipped", reason: "trigger is not kyc_approved" };
  }

  const rewardAmount = Number(settings.reward_amount || 0);
  const currency = String(settings.currency || "USDT").trim().toUpperCase();

  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    return { status: "skipped", reason: "invalid reward amount" };
  }

  const { data: referee, error: refereeErr } = await supabase
    .from("users")
    .select("id, phone, referred_by_user_id")
    .eq("id", refereeUserId)
    .maybeSingle();

  if (refereeErr) throw refereeErr;

  if (!referee || !referee.referred_by_user_id) {
    return { status: "skipped", reason: "user was not referred" };
  }

  const referrerUserId = referee.referred_by_user_id;

  const { data: existingReward, error: existingRewardErr } = await supabase
    .from("referral_rewards")
    .select("id, status")
    .eq("referrer_user_id", referrerUserId)
    .eq("referee_user_id", refereeUserId)
    .eq("trigger_event", "kyc_approved")
    .maybeSingle();

  if (existingRewardErr) throw existingRewardErr;

  if (existingReward) {
    return {
      status: "skipped",
      reason: "reward already exists",
      rewardId: existingReward.id,
    };
  }

  const maxRewardsPerUser = Number(settings.max_rewards_per_user || 0);

  if (maxRewardsPerUser > 0) {
    const { count, error: countErr } = await supabase
      .from("referral_rewards")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", referrerUserId)
      .eq("status", "rewarded");

    if (countErr) throw countErr;

    if ((count || 0) >= maxRewardsPerUser) {
      return {
        status: "skipped",
        reason: "max rewards per user reached",
      };
    }
  }

  const { data: reward, error: rewardInsertErr } = await supabase
    .from("referral_rewards")
    .insert([
      {
        referrer_user_id: referrerUserId,
        referee_user_id: refereeUserId,
        reward_amount: rewardAmount,
        currency,
        trigger_event: "kyc_approved",
        status: "pending",
      },
    ])
    .select()
    .single();

  if (rewardInsertErr) throw rewardInsertErr;

  const { data: existingWallet, error: walletFetchErr } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("user_id", referrerUserId)
    .eq("currency", currency)
    .maybeSingle();

  if (walletFetchErr) throw walletFetchErr;

  let wallet = existingWallet;

  if (!wallet) {
    const { data: createdWallet, error: walletCreateErr } = await supabase
      .from("wallets")
      .insert([
        {
          user_id: referrerUserId,
          currency,
          balance: 0,
        },
      ])
      .select("id, balance")
      .single();

    if (walletCreateErr) throw walletCreateErr;
    wallet = createdWallet;
  }

  const oldBalance = Number(wallet.balance || 0);
  const newBalance = oldBalance + rewardAmount;

  const { error: walletUpdateErr } = await supabase
    .from("wallets")
    .update({ balance: newBalance })
    .eq("id", wallet.id);

  if (walletUpdateErr) throw walletUpdateErr;

  const reference = `REF-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert([
      {
        wallet_id: wallet.id,
        type: "credit",
        amount: rewardAmount,
        description: "Referral reward",
        reference,
      },
    ])
    .select()
    .single();

  if (txErr) throw txErr;

  const { data: rewarded, error: rewardUpdateErr } = await supabase
    .from("referral_rewards")
    .update({
      status: "rewarded",
      rewarded_at: new Date().toISOString(),
    })
    .eq("id", reward.id)
    .select()
    .single();

  if (rewardUpdateErr) throw rewardUpdateErr;

  const adminInfo = req.adminUser;

  await logAdminAction({
    adminId,
    adminPhone: adminInfo?.phone || null,
    action: "REFERRAL_REWARD_GRANTED",
    targetType: "referral_reward",
    targetId: reward.id,
    targetDisplay: `${rewardAmount} ${currency}`,
    oldValue: {
      walletBalance: oldBalance,
      rewardStatus: "pending",
    },
    newValue: {
      walletBalance: newBalance,
      rewardStatus: "rewarded",
      referrerUserId,
      refereeUserId,
      transactionId: tx.id,
      reference,
    },
    req,
  });

  return {
    status: "rewarded",
    rewardId: rewarded.id,
    referrerUserId,
    refereeUserId,
    amount: rewardAmount,
    currency,
    transactionId: tx.id,
    reference,
  };
}

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
      const adminInfo = req.adminUser;
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

      if (existing.status === "approved") {
  return res.status(400).json({
    message: "KYC is already approved",
  });
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

      let referralReward = null;

      try {
        referralReward = await processReferralRewardOnKycApproved({
          refereeUserId: userId,
          adminId,
          req,
        });
      } catch (rewardErr) {
        console.error("referral reward processing failed:", rewardErr);
      }

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "KYC_APPROVED",
        targetType: "kyc",
        targetId: userId,
        targetDisplay: userId,
        oldValue: { status: existing.status },
        newValue: {
          status: "approved",
          referralReward,
        },
        req,
      });

      return res.json({
        message: "KYC approved successfully",
        kyc: data,
        referralReward,
      });
    } catch (err) {
      console.error("admin/kyc/approve crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

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

    if (existing.status === "rejected") {
  return res.status(400).json({
    message: "KYC is already rejected",
  });
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

    if (isProtectedAdminRole(existing.role)) {
  return res.status(403).json({
    message: "Admin accounts cannot be suspended from this endpoint",
  });
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

    if (isProtectedAdminRole(existing.role)) {
  return res.status(403).json({
    message: "Admin accounts cannot be managed from this endpoint",
  });
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

      if (isProtectedAdminRole(user.role)) {
  return res.status(403).json({
    message: "Admin wallets cannot be adjusted from this endpoint",
  });
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

      const matchedUser = await getUserByAdminIdentifier(identifier);

      if (!matchedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = matchedUser.id;

      const [userRes, walletsRes, kycRes, txRes] = await Promise.all([
        supabase
          .from("users")
          .select(`
            id,
            phone,
            email,
            fullName,
            role,
            account_type,
            country_code,
            phone_verified,
            email_verified,
            is_active,
            wallet_account_number,
            referral_code,
            referred_by_user_id,
            created_at
          `)
          .eq("id", userId)
          .maybeSingle(),

        supabase
          .from("wallets")
          .select("id, user_id, currency, balance")
          .eq("user_id", userId)
          .order("currency", { ascending: true }),

        supabase
          .from("kyc_profiles")
          .select(`
            user_id,
            fullName,
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
          .limit(50),
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

      const kycData = kycRes.data
        ? {
            ...kycRes.data,
            id_path: await toKycSignedUrl(kycRes.data.id_path),
            selfie_path: await toKycSignedUrl(kycRes.data.selfie_path),
          }
        : null;

      return res.json({
        user: profile,
        wallets,
        walletSummary,
        kyc: kycData,
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
  pendingServiceRequestsRes,
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

  supabase
    .from("service_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending"),
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
          pendingServiceRequests: pendingServiceRequestsRes.count || 0,
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

router.get(
  "/usdt-scanner/status",
  authMiddleware,
  requireAdmin,
  requirePermission("dashboard.view"),
  async (req, res) => {
    return res.json(getUsdtScannerStatus());
  }
);

// =====================================
// GET /admin/roles/permissions
// Returns role permission matrix
// =====================================
router.get(
  "/roles/permissions",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      return res.json({
        roles: ROLE_PERMISSIONS,
        allPermissions: ALL_PERMISSIONS,
        manageableRoles: MANAGEABLE_ROLES,
      });
    } catch (err) {
      console.error("admin/roles/permissions crash:", err);
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
  requirePermission("users.role.update"),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const { userId, role } = req.body;

      const allowedRoles = MANAGEABLE_ROLES;
      

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
// =====================================
// GET /admin/settings
// Returns global system settings only
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
//   dailyTransferLimit,
//   kycRequired,
//   maintenanceMode,
//   supportedCurrencies
// }
// Updates global system settings only
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

      const dailyTransferLimit = Number(req.body.dailyTransferLimit ?? 0);
      const kycRequired = Boolean(req.body.kycRequired);
      const maintenanceMode = Boolean(req.body.maintenanceMode);
      const supportedCurrenciesRaw = Array.isArray(req.body.supportedCurrencies)
        ? req.body.supportedCurrencies
        : [];

      const supportedCurrencies = supportedCurrenciesRaw
        .map((x) => String(x || "").trim().toUpperCase())
        .filter(Boolean);

      if (!Number.isFinite(dailyTransferLimit) || dailyTransferLimit < 0) {
        return res.status(400).json({
          message: "dailyTransferLimit must be a valid non-negative number",
        });
      }

      if (supportedCurrencies.length === 0) {
        return res.status(400).json({
          message: "At least one supported currency is required",
        });
      }

      const currentRes = await supabase
        .from("system_settings")
        .select(`
          id,
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

// =====================================
// GET /admin/referral-rewards/settings
// =====================================
router.get(
  "/referral-rewards/settings",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.view"),
  async (req, res) => {
    try {
      let { data, error } = await supabase
        .from("referral_reward_settings")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("referral settings GET error:", error);
        return res.status(500).json({ message: "Failed to fetch settings" });
      }

      // auto-seed if empty
      if (!data) {
        const seed = {
          enabled: false,
          reward_amount: 0,
          currency: "USDT",
          trigger_event: "kyc_approved",
          max_rewards_per_user: 50,
        };

        const inserted = await supabase
          .from("referral_reward_settings")
          .insert([seed])
          .select("*")
          .single();

        if (inserted.error) {
          return res.status(500).json({ message: "Failed to init settings" });
        }

        data = inserted.data;
      }

      return res.json({ settings: data });
    } catch (err) {
      console.error("referral settings GET crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// POST /admin/referral-rewards/settings
// =====================================
router.post(
  "/referral-rewards/settings",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.update"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;

      const enabled = Boolean(req.body.enabled);
      const rewardAmount = Number(req.body.rewardAmount || 0);
      const currency = String(req.body.currency || "USDT").toUpperCase();
      const triggerEvent = String(req.body.triggerEvent || "kyc_approved");
      const maxRewards = Number(req.body.maxRewardsPerUser || 0);

      const payload = {
        enabled,
        reward_amount: rewardAmount,
        currency,
        trigger_event: triggerEvent,
        max_rewards_per_user: maxRewards,
        updated_at: new Date().toISOString(),
      };

      const { data: current } = await supabase
        .from("referral_reward_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      let saved;

      if (!current) {
        const inserted = await supabase
          .from("referral_reward_settings")
          .insert([payload])
          .select("*")
          .single();

        saved = inserted.data;
      } else {
        const updated = await supabase
          .from("referral_reward_settings")
          .update(payload)
          .eq("id", current.id)
          .select("*")
          .single();

        saved = updated.data;
      }

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "REFERRAL_SETTINGS_UPDATED",
        targetType: "referral_settings",
        targetId: saved.id,
        oldValue: current,
        newValue: saved,
        req,
      });

      return res.json({
        message: "Referral settings updated",
        settings: saved,
      });
    } catch (err) {
      console.error("referral settings POST crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/referral-rewards/history
// =====================================
router.get(
  "/referral-rewards/history",
  authMiddleware,
  requireAdmin,
  requirePermission("transactions.view"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("referral_rewards")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("referral history error:", error);
        return res.status(500).json({ message: "Failed to fetch history" });
      }

      return res.json({ rewards: data || [] });
    } catch (err) {
      console.error("referral history crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/settings/currencies
// Returns per-currency fee and transfer settings
// =====================================
router.get(
  "/settings/currencies",
  authMiddleware,
  requireAdmin,
  requirePermission("currency_settings.view"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("currency_settings")
        .select(`
          id,
          currency,
          fee_percent,
          flat_fee,
          min_transfer,
          max_transfer,
          is_enabled,
          updated_at
        `)
        .order("currency", { ascending: true });

      if (error) {
        console.error("admin/settings/currencies GET error:", error);
        return res.status(500).json({ message: "Failed to fetch currency settings" });
      }

      return res.json({
        currencies: (data || []).map((row) => ({
          id: row.id,
          currency: row.currency,
          feePercent: Number(row.fee_percent || 0),
          flatFee: Number(row.flat_fee || 0),
          minTransfer: Number(row.min_transfer || 0),
          maxTransfer: Number(row.max_transfer || 0),
          isEnabled: Boolean(row.is_enabled),
          updatedAt: row.updated_at,
        })),
      });
    } catch (err) {
      console.error("admin/settings/currencies GET crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// POST /admin/settings/currencies/:currency
// Body: {
//   feePercent,
//   flatFee,
//   minTransfer,
//   maxTransfer,
//   isEnabled
// }
// =====================================
router.post(
  "/settings/currencies/:currency",
  authMiddleware,
  requireAdmin,
  requirePermission("currency_settings.update"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;
      const currency = String(req.params.currency || "").trim().toUpperCase();

      if (!currency) {
        return res.status(400).json({ message: "currency is required" });
      }

      const feePercent = Number(req.body.feePercent ?? 0);
      const flatFee = Number(req.body.flatFee ?? 0);
      const minTransfer = Number(req.body.minTransfer ?? 0);
      const maxTransfer = Number(req.body.maxTransfer ?? 0);
      const isEnabled = Boolean(req.body.isEnabled);

      if (!Number.isFinite(feePercent) || feePercent < 0) {
        return res.status(400).json({ message: "feePercent must be a valid non-negative number" });
      }

      if (!Number.isFinite(flatFee) || flatFee < 0) {
        return res.status(400).json({ message: "flatFee must be a valid non-negative number" });
      }

      if (!Number.isFinite(minTransfer) || minTransfer < 0) {
        return res.status(400).json({ message: "minTransfer must be a valid non-negative number" });
      }

      if (!Number.isFinite(maxTransfer) || maxTransfer < 0) {
        return res.status(400).json({ message: "maxTransfer must be a valid non-negative number" });
      }

      if (maxTransfer > 0 && minTransfer > maxTransfer) {
        return res.status(400).json({ message: "minTransfer cannot be greater than maxTransfer" });
      }

      const currentRes = await supabase
        .from("currency_settings")
        .select(`
          id,
          currency,
          fee_percent,
          flat_fee,
          min_transfer,
          max_transfer,
          is_enabled,
          updated_at
        `)
        .eq("currency", currency)
        .maybeSingle();

      if (currentRes.error) {
        console.error("admin/settings/currencies current lookup error:", currentRes.error);
        return res.status(500).json({ message: "Failed to load current currency settings" });
      }

      const oldValue = currentRes.data
        ? {
            currency: currentRes.data.currency,
            feePercent: Number(currentRes.data.fee_percent || 0),
            flatFee: Number(currentRes.data.flat_fee || 0),
            minTransfer: Number(currentRes.data.min_transfer || 0),
            maxTransfer: Number(currentRes.data.max_transfer || 0),
            isEnabled: Boolean(currentRes.data.is_enabled),
            updatedAt: currentRes.data.updated_at,
          }
        : null;

      const payload = {
        currency,
        fee_percent: feePercent,
        flat_fee: flatFee,
        min_transfer: minTransfer,
        max_transfer: maxTransfer,
        is_enabled: isEnabled,
        updated_at: new Date().toISOString(),
      };

      let saved;

      if (!currentRes.data) {
        const insertRes = await supabase
          .from("currency_settings")
          .insert([payload])
          .select(`
            id,
            currency,
            fee_percent,
            flat_fee,
            min_transfer,
            max_transfer,
            is_enabled,
            updated_at
          `)
          .single();

        if (insertRes.error) {
          console.error("admin/settings/currencies insert error:", insertRes.error);
          return res.status(500).json({ message: "Failed to save currency settings" });
        }

        saved = insertRes.data;
      } else {
        const updateRes = await supabase
          .from("currency_settings")
          .update(payload)
          .eq("id", currentRes.data.id)
          .select(`
            id,
            currency,
            fee_percent,
            flat_fee,
            min_transfer,
            max_transfer,
            is_enabled,
            updated_at
          `)
          .single();

        if (updateRes.error) {
          console.error("admin/settings/currencies update error:", updateRes.error);
          return res.status(500).json({ message: "Failed to update currency settings" });
        }

        saved = updateRes.data;
      }

      const newValue = {
        currency: saved.currency,
        feePercent: Number(saved.fee_percent || 0),
        flatFee: Number(saved.flat_fee || 0),
        minTransfer: Number(saved.min_transfer || 0),
        maxTransfer: Number(saved.max_transfer || 0),
        isEnabled: Boolean(saved.is_enabled),
        updatedAt: saved.updated_at,
      };

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "CURRENCY_SETTINGS_UPDATED",
        targetType: "currency_settings",
        targetId: saved.id,
        targetDisplay: saved.currency,
        oldValue,
        newValue,
        req,
      });

      return res.json({
        message: "Currency settings updated successfully",
        currency: newValue,
      });
    } catch (err) {
      console.error("admin/settings/currencies POST crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/exchange-rates",
  authMiddleware,
  requireAdmin,
  requirePermission("currency_settings.view"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("exchange_rates")
        .select(
          "from_currency, to_currency, rate, fee_percent, flat_fee, min_amount, max_amount, is_enabled"
        )
        .order("from_currency", { ascending: true })
        .order("to_currency", { ascending: true });

      if (error) {
        console.error("admin/exchange-rates error:", error);
        return res.status(500).json({ message: "Failed to load exchange rates" });
      }

      return res.json({ rates: data || [] });
    } catch (err) {
      console.error("admin/exchange-rates crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/exchange-rates",
  authMiddleware,
  requireAdmin,
  requirePermission("currency_settings.update"),
  async (req, res) => {
    try {
      const fromCurrency = String(req.body.fromCurrency || "").trim().toUpperCase();
      const toCurrency = String(req.body.toCurrency || "").trim().toUpperCase();

      const rate = Number(req.body.rate || 0);
      const feePercent = Number(req.body.feePercent || 0);
      const flatFee = Number(req.body.flatFee || 0);
      const minAmount = Number(req.body.minAmount || 0);
      const maxAmount = Number(req.body.maxAmount || 0);
      const isEnabled = Boolean(req.body.isEnabled);

      if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
        return res.status(400).json({ message: "Invalid currency pair" });
      }

      if (!rate || rate <= 0) {
        return res.status(400).json({ message: "Rate must be greater than 0" });
      }

      if (feePercent < 0 || flatFee < 0 || minAmount < 0 || maxAmount < 0) {
        return res.status(400).json({ message: "Values cannot be negative" });
      }

      if (maxAmount > 0 && minAmount > maxAmount) {
        return res.status(400).json({ message: "Min amount cannot exceed max amount" });
      }

      const { data: oldRate } = await supabase
        .from("exchange_rates")
        .select("*")
        .eq("from_currency", fromCurrency)
        .eq("to_currency", toCurrency)
        .maybeSingle();

      const payload = {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        rate,
        fee_percent: feePercent,
        flat_fee: flatFee,
        min_amount: minAmount,
        max_amount: maxAmount,
        is_enabled: isEnabled,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("exchange_rates")
        .upsert(payload, { onConflict: "from_currency,to_currency" })
        .select()
        .maybeSingle();

      if (error) {
        console.error("admin/exchange-rates update error:", error);
        return res.status(500).json({ message: "Failed to save exchange rate" });
      }

      await logAdminAction({
        adminId: req.adminUser.id,
        adminPhone: req.adminUser.phone,
        action: "EXCHANGE_RATE_UPDATED",
        targetType: "exchange_rate",
        targetId: `${fromCurrency}_${toCurrency}`,
        targetDisplay: `${fromCurrency} → ${toCurrency}`,
        oldValue: oldRate || null,
        newValue: data,
        req,
      });

      return res.json({
        message: "Exchange rate saved successfully",
        rate: data,
      });
    } catch (err) {
      console.error("admin/exchange-rates update crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);


// =====================================
// GET /admin/export/users.csv
// =====================================
router.get(
  "/export/users.csv",
  authMiddleware,
  requireAdmin,
  requirePermission("users.view"),
  async (req, res) => {
    try {
      const role = String(req.query.role || "").trim().toLowerCase();
      const search = String(req.query.search || "").trim();

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
          wallet_account_number
        `)
        .order("created_at", { ascending: false });

      if (role) {
        query = query.eq("role", role);
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
        console.error("export users csv error:", error);
        return res.status(500).json({ message: "Failed to export users CSV" });
      }

      const rows = data || [];

      const header = [
        "id",
        "phone",
        "role",
        "account_type",
        "phone_verified",
        "is_active",
        "wallet_account_number",
        "created_at",
      ];

      const escapeCsv = (value) => {
        const str = String(value ?? "");
        if (str.includes('"') || str.includes(",") || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csv = [
        header.join(","),
        ...rows.map((item) =>
          [
            item.id,
            item.phone,
            item.role,
            item.account_type,
            item.phone_verified,
            item.is_active,
            item.wallet_account_number,
            item.created_at,
          ]
            .map(escapeCsv)
            .join(",")
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="users.csv"');
      return res.status(200).send(csv);
    } catch (err) {
      console.error("export users csv crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/export/transactions.csv
// =====================================
router.get(
  "/export/transactions.csv",
  authMiddleware,
  requireAdmin,
  requirePermission("transactions.view"),
  async (req, res) => {
    try {
      const type = String(req.query.type || "").trim().toLowerCase();
      const reference = String(req.query.reference || "").trim();
      const search = String(req.query.search || "").trim();

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
        .order("created_at", { ascending: false });

      if (type) {
        query = query.eq("type", type);
      }

      if (reference) {
        query = query.ilike("reference", `%${reference}%`);
      }

      if (userIdFilter) {
        query = query.eq("wallets.user_id", userIdFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error("export transactions csv error:", error);
        return res
          .status(500)
          .json({ message: "Failed to export transactions CSV" });
      }

      const rows = data || [];

      const header = [
        "id",
        "wallet_id",
        "user_id",
        "currency",
        "type",
        "amount",
        "description",
        "reference",
        "created_at",
      ];

      const escapeCsv = (value) => {
        const str = String(value ?? "");
        if (str.includes('"') || str.includes(",") || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csv = [
        header.join(","),
        ...rows.map((item) =>
          [
            item.id,
            item.wallet_id,
            item.wallets?.user_id || "",
            item.wallets?.currency || "",
            item.type,
            item.amount,
            item.description,
            item.reference,
            item.created_at,
          ]
            .map(escapeCsv)
            .join(",")
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="transactions.csv"'
      );
      return res.status(200).send(csv);
    } catch (err) {
      console.error("export transactions csv crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/export/kyc.csv
// =====================================
router.get(
  "/export/kyc.csv",
  authMiddleware,
  requireAdmin,
  requirePermission("kyc.view"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "").trim().toLowerCase();

      let query = supabase
        .from("kyc_profiles")
        .select(`
          user_id,
          fullName,
          dob,
          address,
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
        console.error("export kyc csv error:", error);
        return res.status(500).json({ message: "Failed to export KYC CSV" });
      }

      const rows = data || [];

      const header = [
        "user_id",
        "fullName",
        "dob",
        "address",
        "status",
        "created_at",
        "updated_at",
      ];

      const escapeCsv = (value) => {
        const str = String(value ?? "");
        if (str.includes('"') || str.includes(",") || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csv = [
        header.join(","),
        ...rows.map((item) =>
          [
            item.user_id,
            item.fullName,
            item.dob,
            item.address,
            item.status,
            item.created_at,
            item.updated_at,
          ]
            .map(escapeCsv)
            .join(",")
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="kyc.csv"');
      return res.status(200).send(csv);
    } catch (err) {
      console.error("export kyc csv crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// GET /admin/withdrawals
// =====================================
router.get(
  "/withdrawals",
  authMiddleware,
  requireAdmin,
  requirePermission("transactions.view"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("withdraw_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("fetch withdrawals error:", error);
        return res.status(500).json({ message: "Failed to fetch withdrawals" });
      }

      return res.json({ withdrawals: data || [] });
    } catch (err) {
      console.error("withdrawals crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// =====================================
// POST /admin/withdrawals/:id/approve
// =====================================
router.post(
  "/withdrawals/:id/approve",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const id = req.params.id;

      const { data: reqData } = await supabase
        .from("withdraw_requests")
        .select("*")
        .eq("id", id)
        .single();

      if (!reqData || reqData.status !== "pending") {
        return res.status(400).json({ message: "Invalid request" });
      }

      // deduct balance
      const { data: wallet } = await supabase
        .from("wallets")
        .select("*")
        .eq("id", reqData.wallet_id)
        .single();

      if (wallet.balance < reqData.amount) {
        return res.status(400).json({ message: "Insufficient balance" });
      }

      const newBalance = wallet.balance - reqData.amount;
      const adminInfo = req.adminUser;



      await supabase
        .from("wallets")
        .update({ balance: newBalance })
        .eq("id", wallet.id);

      await supabase.from("transactions").insert({
        wallet_id: wallet.id,
        type: "debit",
        amount: reqData.amount,
        description: "Withdrawal approved",
      });

      await supabase
        .from("withdraw_requests")
        .update({
          status: "approved",
          admin_id: adminId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id);

        await logAdminAction({
  adminId,
  adminPhone: adminInfo?.phone || null,
  action: "WITHDRAWAL_APPROVED",
  targetType: "withdrawal",
  targetId: id,
  targetDisplay: `${reqData.amount} ${wallet.currency || ""}`,
  oldValue: {
    status: reqData.status,
    walletBalance: Number(wallet.balance || 0),
  },
  newValue: {
    status: "approved",
    walletBalance: newBalance,
    amount: Number(reqData.amount || 0),
    walletId: wallet.id,
  },
  req,
});

      return res.json({ message: "Withdrawal approved" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Approval failed" });
    }
  }
);

// =====================================
// POST /admin/withdrawals/:id/reject
// =====================================
router.post(
  "/withdrawals/:id/reject",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const id = req.params.id;

      const { data: reqData, error: fetchErr } = await supabase
  .from("withdraw_requests")
  .select("*")
  .eq("id", id)
  .maybeSingle();

if (fetchErr) {
  console.error("withdrawal reject lookup error:", fetchErr);
  return res.status(500).json({ message: "Withdrawal lookup failed" });
}

if (!reqData) {
  return res.status(404).json({ message: "Withdrawal request not found" });
}

if (reqData.status !== "pending") {
  return res.status(400).json({ message: "Only pending withdrawals can be rejected" });
}

      await supabase
        .from("withdraw_requests")
        .update({
          status: "rejected",
          admin_id: adminId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id);

        const adminInfo = req.adminUser;

await logAdminAction({
  adminId,
  adminPhone: adminInfo?.phone || null,
  action: "WITHDRAWAL_REJECTED",
  targetType: "withdrawal",
  targetId: id,
  targetDisplay: `${reqData.amount || ""} ${reqData.currency || ""}`,
  oldValue: {
    status: reqData.status,
  },
  newValue: {
    status: "rejected",
    amount: Number(reqData.amount || 0),
    walletId: reqData.wallet_id,
  },
  req,
});

      return res.json({ message: "Withdrawal rejected" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Reject failed" });
    }
    
  }
  
);


// =====================================
// ADMIN: SERVICE REQUESTS LIST
// GET /admin/service-requests?status=pending&search=abc&serviceType=starlink
// =====================================
router.get(
  "/service-requests",
  authMiddleware,
  requireAdmin,
  requirePermission("transactions.view"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "").trim().toLowerCase();
      const search = String(req.query.search || "").trim();
      const serviceType = String(req.query.serviceType || "").trim().toLowerCase();

      let query = supabase
        .from("service_requests")
        .select(`
          id,
          user_id,
          wallet_id,
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
          rejected_at,
          completed_by,
          rejected_by
        `)
        .order("created_at", { ascending: false })
        .limit(150);

      if (status) {
        query = query.eq("status", status);
      }

      if (serviceType && serviceType !== "all") {
        query = query.eq("service_type", serviceType);
      }

      if (search) {
        query = query.or(
          [
            `provider.ilike.%${search}%`,
            `customer_reference.ilike.%${search}%`,
            `transaction_reference.ilike.%${search}%`,
            `user_id.eq.${search}`,
            `wallet_id.eq.${search}`,
          ].join(",")
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error("[admin service requests] fetch error:", error);
        return res.status(500).json({
          message: "Failed to fetch service requests",
        });
      }

      return res.json({
        requests: data || [],
      });
    } catch (err) {
      console.error("[admin service requests] crash:", err);
      return res.status(500).json({
        message: "Failed to fetch service requests",
      });
    }
  }
);

// =====================================
// ADMIN: COMPLETE SERVICE REQUEST
// PATCH /admin/service-requests/:id/complete
// Body: { adminNote }
// =====================================
router.patch(
  "/service-requests/:id/complete",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;
      const requestId = req.params.id;
      const adminNote = String(req.body.adminNote || "").trim() || null;

      const { data: existing, error: lookupErr } = await supabase
        .from("service_requests")
        .select(`
          id,
          user_id,
          wallet_id,
          service_type,
          provider,
          customer_reference,
          currency,
          amount,
          status,
          note,
          admin_note,
          transaction_reference,
          created_at
        `)
        .eq("id", requestId)
        .maybeSingle();

      if (lookupErr) {
        console.error("[complete service request] lookup error:", lookupErr);
        return res.status(500).json({ message: "Request lookup failed" });
      }

      if (!existing) {
        return res.status(404).json({ message: "Service request not found" });
      }

      if (existing.status !== "pending") {
        return res.status(400).json({
          message: "Only pending requests can be completed",
        });
      }

      const { data: updated, error: updateErr } = await supabase
        .from("service_requests")
        .update({
          status: "completed",
          admin_note: adminNote,
          completed_at: new Date().toISOString(),
          completed_by: adminId,
        })
        .eq("id", requestId)
        .select(`
          id,
          user_id,
          wallet_id,
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
          completed_by
        `)
        .single();

      if (updateErr) {
        console.error("[complete service request] update error:", updateErr);
        return res.status(500).json({
          message: "Failed to complete request",
        });
      }

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "SERVICE_REQUEST_COMPLETED",
        targetType: "service_request",
        targetId: existing.id,
        targetDisplay: `${existing.service_type || "service"} • ${existing.amount} ${existing.currency}`,
        oldValue: {
          status: existing.status,
          admin_note: existing.admin_note,
        },
        newValue: {
          status: "completed",
          admin_note: adminNote,
          service_type: existing.service_type,
          provider: existing.provider,
          customer_reference: existing.customer_reference,
          amount: Number(existing.amount || 0),
          currency: existing.currency,
          user_id: existing.user_id,
          wallet_id: existing.wallet_id,
          transaction_reference: existing.transaction_reference,
        },
        req,
      });

      return res.json({
        message: "Service request completed",
        request: updated,
      });
    } catch (err) {
      console.error("[complete service request] crash:", err);
      return res.status(500).json({
        message: "Failed to complete request",
      });
    }
  }
);

// =====================================
// ADMIN: REJECT SERVICE REQUEST + REFUND
// PATCH /admin/service-requests/:id/reject
// Body: { adminNote }
// =====================================
router.patch(
  "/service-requests/:id/reject",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const adminInfo = req.adminUser;
      const requestId = req.params.id;
      const adminNote =
        String(req.body.adminNote || "").trim() || "Request rejected";

      const { data: existing, error: lookupErr } = await supabase
        .from("service_requests")
        .select(`
          id,
          user_id,
          wallet_id,
          service_type,
          provider,
          customer_reference,
          currency,
          amount,
          status,
          note,
          admin_note,
          transaction_reference,
          created_at
        `)
        .eq("id", requestId)
        .maybeSingle();

      if (lookupErr) {
        console.error("[reject service request] lookup error:", lookupErr);
        return res.status(500).json({ message: "Request lookup failed" });
      }

      if (!existing) {
        return res.status(404).json({ message: "Service request not found" });
      }

      if (existing.status !== "pending") {
        return res.status(400).json({
          message: "Only pending requests can be rejected",
        });
      }

      const { data: wallet, error: walletErr } = await supabase
        .from("wallets")
        .select("id, balance")
        .eq("id", existing.wallet_id)
        .maybeSingle();

      if (walletErr || !wallet) {
        console.error("[reject service request] wallet lookup error:", walletErr);
        return res.status(500).json({ message: "Wallet lookup failed" });
      }

      const oldBalance = Number(wallet.balance || 0);
      const refundAmount = Number(existing.amount || 0);
      const newBalance = oldBalance + refundAmount;

      const { error: refundErr } = await supabase
        .from("wallets")
        .update({ balance: newBalance })
        .eq("id", wallet.id);

      if (refundErr) {
        console.error("[reject service request] refund error:", refundErr);
        return res.status(500).json({ message: "Refund failed" });
      }

      const refundReference = `REF-${Date.now()}`;

      const { data: refundTx, error: txErr } = await supabase
        .from("transactions")
        .insert({
          wallet_id: wallet.id,
          type: "credit",
          amount: refundAmount,
          description: "Service request refund",
          reference: refundReference,
        })
        .select()
        .single();

      if (txErr) {
        console.error("[reject service request] refund transaction error:", txErr);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("service_requests")
        .update({
          status: "rejected",
          admin_note: adminNote,
          rejected_at: new Date().toISOString(),
          rejected_by: adminId,
        })
        .eq("id", requestId)
        .select(`
          id,
          user_id,
          wallet_id,
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
          rejected_at,
          rejected_by
        `)
        .single();

      if (updateErr) {
        console.error("[reject service request] update error:", updateErr);
        return res.status(500).json({
          message: "Request rejected but status update failed",
        });
      }

      await logAdminAction({
        adminId,
        adminPhone: adminInfo?.phone || null,
        action: "SERVICE_REQUEST_REJECTED_REFUNDED",
        targetType: "service_request",
        targetId: existing.id,
        targetDisplay: `${existing.service_type || "service"} • ${existing.amount} ${existing.currency}`,
        oldValue: {
          status: existing.status,
          walletBalance: oldBalance,
          admin_note: existing.admin_note,
        },
        newValue: {
          status: "rejected",
          admin_note: adminNote,
          refundAmount,
          refundReference,
          refundTransactionId: refundTx?.id || null,
          walletBalance: newBalance,
          service_type: existing.service_type,
          provider: existing.provider,
          customer_reference: existing.customer_reference,
          amount: Number(existing.amount || 0),
          currency: existing.currency,
          user_id: existing.user_id,
          wallet_id: existing.wallet_id,
          transaction_reference: existing.transaction_reference,
        },
        req,
      });

      return res.json({
        message: "Service request rejected and refunded",
        refundReference,
        request: updated,
      });
    } catch (err) {
      console.error("[reject service request] crash:", err);
      return res.status(500).json({
        message: "Failed to reject request",
      });
    }
  }
);

router.get(
  "/company-wallet",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.view"),
  async (req, res) => {
    try {
      const { data: systemAccount, error: systemErr } = await supabase
        .from("system_accounts")
        .select("user_id")
        .eq("key", "COMPANY_FEES")
        .maybeSingle();

      if (systemErr) {
        console.error("company-wallet system account error:", systemErr);
        return res.status(500).json({ message: "Failed to load company account" });
      }

      if (!systemAccount?.user_id) {
        return res.status(404).json({ message: "Company fee account not configured" });
      }

      const companyUserId = systemAccount.user_id;

      const { data: wallets, error: walletsErr } = await supabase
        .from("wallets")
        .select("id, currency, balance")
        .eq("user_id", companyUserId)
        .order("currency", { ascending: true });

      if (walletsErr) {
        console.error("company-wallet wallets error:", walletsErr);
        return res.status(500).json({ message: "Failed to load company wallets" });
      }

      const walletIds = (wallets || []).map((w) => w.id);

      let recentTransactions = [];

      if (walletIds.length > 0) {
        const { data: txs, error: txErr } = await supabase
          .from("transactions")
          .select("id, wallet_id, type, amount, description, reference, created_at, wallets(currency)")
          .in("wallet_id", walletIds)
          .eq("description", "Fee income")
          .order("created_at", { ascending: false })
          .limit(50);

        if (txErr) {
          console.error("company-wallet tx error:", txErr);
          return res.status(500).json({ message: "Failed to load company transactions" });
        }

        recentTransactions = txs || [];
      }

      const balances = (wallets || []).map((w) => ({
        walletId: w.id,
        currency: w.currency,
        balance: Number(w.balance || 0),
      }));

      const feeSummary = {};

      for (const tx of recentTransactions) {
        const currency = tx.wallets?.currency || "UNKNOWN";
        feeSummary[currency] = (feeSummary[currency] || 0) + Number(tx.amount || 0);
      }

      return res.json({
        companyUserId,
        balances,
        recentTransactions,
        recentFeeSummary: feeSummary,
      });
    } catch (err) {
      console.error("company-wallet crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/crypto/withdrawals/:id/approve",
  authMiddleware,
  requireAdmin,
  requirePermission("crypto.withdrawals.approve"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const withdrawalId = req.params.id;

      const { data: withdrawal, error: fetchErr } = await supabase
        .from("crypto_withdrawals")
        .select("*")
        .eq("id", withdrawalId)
        .maybeSingle();

      if (fetchErr || !withdrawal) {
        return res.status(404).json({ message: "Withdrawal not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ message: "Withdrawal is not pending" });
      }

      const withdrawalNetwork = String(withdrawal.network || "TRC20").toUpperCase();

if (withdrawalNetwork === "TRC20" && !process.env.TRON_TREASURY_PRIVATE_KEY) {
  return res.status(500).json({ message: "TRC20 treasury wallet not configured" });
}

if (withdrawalNetwork === "BEP20" && !process.env.BSC_TREASURY_PRIVATE_KEY) {
  return res.status(500).json({ message: "BEP20 treasury wallet not configured" });
}

if (!["TRC20", "BEP20"].includes(withdrawalNetwork)) {
  return res.status(400).json({ message: "Unsupported withdrawal network" });
}

      const { data: lockedWithdrawal, error: lockErr } = await supabase
  .from("crypto_withdrawals")
  .update({
    status: "processing",
    submitted_at: new Date().toISOString(),
    admin_id: adminId,
  })
  .eq("id", withdrawalId)
  .eq("status", "pending")
  .select("*")
  .maybeSingle();

if (lockErr || !lockedWithdrawal) {
  return res.status(400).json({
    message: "Withdrawal is no longer pending",
  });
}

     try {
  const lockedNetwork = String(lockedWithdrawal.network || "TRC20").toUpperCase();

  let txHash;

  if (lockedNetwork === "TRC20") {
    txHash = await sendUsdtTrc20FromPrivateKey({
      fromPrivateKey: process.env.TRON_TREASURY_PRIVATE_KEY,
      toAddress: lockedWithdrawal.to_address,
      amount: Number(lockedWithdrawal.amount),
    });

    await supabase
      .from("crypto_withdrawals")
      .update({ tx_hash: txHash })
      .eq("id", withdrawalId);

    await waitForTransactionSuccess(txHash);
  } else if (lockedNetwork === "BEP20") {
    txHash = await sendUsdtBep20FromPrivateKey({
      fromPrivateKey: process.env.BSC_TREASURY_PRIVATE_KEY,
      toAddress: lockedWithdrawal.to_address,
      amount: Number(lockedWithdrawal.amount),
    });

    await supabase
      .from("crypto_withdrawals")
      .update({ tx_hash: txHash })
      .eq("id", withdrawalId);
  } else {
    throw new Error("Unsupported withdrawal network");
  }

  await supabase.from("transactions").insert([
    {
      wallet_id: lockedWithdrawal.wallet_id,
      type: "debit",
      amount: lockedWithdrawal.amount,
      description: `${lockedNetwork} USDT withdrawal`,
      reference: lockedWithdrawal.reference,
    },
    {
      wallet_id: lockedWithdrawal.wallet_id,
      type: "debit",
      amount: lockedWithdrawal.fee,
      description: `${lockedNetwork} USDT withdrawal fee`,
      reference: lockedWithdrawal.reference,
    },
  ]);

  const { error: completeErr } = await supabase
    .from("crypto_withdrawals")
    .update({
      status: "completed",
      tx_hash: txHash,
      admin_id: adminId,
      completed_at: new Date().toISOString(),
    })
    .eq("id", withdrawalId);

  if (completeErr) {
    console.error("complete withdrawal update error:", completeErr);
    return res.status(500).json({
      message: "Withdrawal sent but failed to mark completed. Manual review required.",
      txHash,
    });
  }

  await logAdminAction({
    adminId,
    adminPhone: req.adminUser?.phone || null,
    action: "CRYPTO_WITHDRAWAL_APPROVED",
    targetType: "crypto_withdrawal",
    targetId: withdrawalId,
    targetDisplay: lockedWithdrawal.to_address,
    oldValue: { status: "pending" },
    newValue: { status: "completed", network: lockedNetwork, txHash },
    req,
  });

  return res.json({
    message: "Withdrawal approved and sent",
    network: lockedNetwork,
    txHash,
    reference: lockedWithdrawal.reference,
  });
} catch (sendErr) {
        await supabase
  .from("crypto_withdrawals")
  .update({
    status: "failed",
    error_message: sendErr.message || "Blockchain send failed",
    failed_at: new Date().toISOString(),
  })
  
  .eq("id", withdrawalId);
  const refundAmount = Number(lockedWithdrawal.total_debit || 0);

const { data: wallet } = await supabase
  .from("wallets")
  .select("id, balance")
  .eq("id", lockedWithdrawal.wallet_id)
  .maybeSingle();

if (wallet && refundAmount > 0) {
  await supabase
    .from("wallets")
    .update({
      balance: Number(wallet.balance || 0) + refundAmount,
    })
    .eq("id", wallet.id);
}

        return res.status(500).json({
          message: sendErr.message || "Blockchain send failed",
        });
      }
    } catch (err) {
      console.error("approve withdrawal crash:", err);
      return res.status(500).json({ message: "Failed to approve withdrawal" });
    }
  }
);

router.post(
  "/crypto/withdrawals/:id/reject",
  authMiddleware,
  requireAdmin,
  requirePermission("crypto.withdrawals.reject"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const withdrawalId = req.params.id;
      const reason = String(req.body.reason || "").trim() || "Rejected by admin";

      const { data: withdrawal, error: fetchErr } = await supabase
        .from("crypto_withdrawals")
        .select("*")
        .eq("id", withdrawalId)
        .maybeSingle();

      if (fetchErr || !withdrawal) {
        return res.status(404).json({ message: "Withdrawal not found" });
      }

      const { data: lockedWithdrawal, error: lockErr } = await supabase
  .from("crypto_withdrawals")
  .update({
    status: "rejecting",
    admin_id: adminId,
    admin_note: reason,
  })
  .eq("id", withdrawalId)
  .eq("status", "pending")
  .select("*")
  .maybeSingle();

if (lockErr || !lockedWithdrawal) {
  return res.status(400).json({
    message: "Withdrawal is no longer pending",
  });
}

      const { data: wallet, error: walletErr } = await supabase
        .from("wallets")
        .select("id, balance")
        .eq("id", lockedWithdrawal.wallet_id)
        .maybeSingle();

      if (walletErr || !wallet) {
        return res.status(400).json({ message: "Wallet not found" });
      }

      const refundAmount = Number(lockedWithdrawal.total_debit || 0);
      const newBalance = Number(wallet.balance || 0) + refundAmount;

      const { error: refundErr } = await supabase
        .from("wallets")
        .update({ balance: newBalance })
        .eq("id", wallet.id);

      if (refundErr) {
        return res.status(500).json({ message: "Failed to refund wallet" });
      }

      await supabase
  .from("crypto_withdrawals")
  .update({
    status: "rejected",
    error_message: reason,
    admin_note: reason,
    admin_id: adminId,
    failed_at: new Date().toISOString(),
  })
    .eq("id", withdrawalId);

      await logAdminAction({
        adminId,
        adminPhone: req.adminUser?.phone || null,
        action: "CRYPTO_WITHDRAWAL_REJECTED",
        targetType: "crypto_withdrawal",
        targetId: withdrawalId,
        targetDisplay: withdrawal.to_address,
        oldValue: { status: "pending" },
        newValue: { status: "rejected", reason, refunded: refundAmount },
        req,
      });

      return res.json({
        message: "Withdrawal rejected and refunded",
        refunded: refundAmount,
      });
    } catch (err) {
      console.error("reject withdrawal crash:", err);
      return res.status(500).json({ message: "Failed to reject withdrawal" });
    }
  }
);

router.get(
  "/crypto/withdrawals",
  authMiddleware,
  requireAdmin,
  requirePermission("crypto.withdrawals.view"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "pending").trim().toLowerCase();
      const reference = String(req.query.reference || "").trim();
      const address = String(req.query.address || "").trim();
      const userId = String(req.query.userId || "").trim();

      let query = supabase
        .from("crypto_withdrawals")
        .select(`
          id,
          user_id,
          wallet_id,
          network,
          token,
          to_address,
          amount,
          fee,
          total_debit,
          status,
          tx_hash,
          reference,
          error_message,
          admin_id,
          admin_note,
          created_at,
          submitted_at,
          completed_at,
          failed_at,
          users (
            id,
            phone,
            wallet_account_number
          )
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (status && status !== "all") {
        query = query.eq("status", status);
      }

      if (reference) {
        query = query.eq("reference", reference);
      }

      if (address) {
        query = query.ilike("to_address", `%${address}%`);
      }

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[admin crypto withdrawals] fetch error:", error);
        return res.status(500).json({
          message: "Failed to fetch crypto withdrawals",
        });
      }

      return res.json({
        withdrawals: data || [],
      });
    } catch (err) {
      console.error("[admin crypto withdrawals] crash:", err);
      return res.status(500).json({
        message: "Failed to fetch crypto withdrawals",
      });
    }
  }
);

router.post(
  "/crypto/deposits/sweep",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const limit = Number(req.body.limit || 5);

      const results = await sweepCreditedUsdtDeposits(limit);
      await supabase.from("scanner_logs").insert({
  operation: "trc20_sweep",
  results,
});

      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "USDT_DEPOSITS_SWEEP_RUN",
        targetType: "crypto_deposits",
        targetId: null,
        targetDisplay: "TRC20 deposit sweep",
        oldValue: null,
        newValue: { results },
        req,
      });

      return res.json({
        message: "USDT sweep completed",
        results,
      });
    } catch (err) {
      console.error("USDT sweep route error:", err);
      return res.status(500).json({
        message: err.message || "USDT sweep failed",
      });
    }
  }
);

router.post(
  "/crypto/deposits/scan-bep20",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const result = await scanUsdtBep20Deposits();
      await supabase.from("scanner_logs").insert({
  operation: "bep20_scan",
  result,
});

      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "USDT_BEP20_DEPOSIT_SCAN_RUN",
        targetType: "crypto_deposits",
        targetId: null,
        targetDisplay: "BEP20 deposit scanner",
        oldValue: null,
        newValue: result,
        req,
      });

      return res.json(result);
    } catch (err) {
      console.error("BEP20 deposit scan route error:", err);
      return res.status(500).json({
        message: err.message || "BEP20 deposit scan failed",
      });
    }
  }
);

router.post(
  "/crypto/deposits/sweep-bep20",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const limit = Number(req.body.limit || 5);

      const results = await sweepCreditedBep20Deposits(limit);
      await supabase.from("scanner_logs").insert({
  operation: "bep20_sweep",
  result: { results },
});

      await logAdminAction({
        adminId: req.user.userId,
        adminPhone: req.adminUser?.phone || null,
        action: "USDT_BEP20_DEPOSITS_SWEEP_RUN",
        targetType: "crypto_deposits",
        targetId: null,
        targetDisplay: "BEP20 deposit sweep",
        oldValue: null,
        newValue: { results },
        req,
      });

      return res.json({
        message: "BEP20 USDT sweep completed",
        results,
      });
    } catch (err) {
      console.error("BEP20 sweep route error:", err);
      return res.status(500).json({
        message: err.message || "BEP20 sweep failed",
      });
    }
  }
);

async function saveScannerLog(operation, result) {
  await supabase.from("scanner_logs").insert({
    operation,
    result,
  });
}

router.get(
  "/scanner-logs",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("scanner_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("scanner logs fetch error:", error);
        return res.status(500).json({ message: "Failed to load scanner logs" });
      }

      return res.json({ logs: data || [] });
    } catch (err) {
      console.error("scanner logs crash:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/tronmax/rent-energy",
  authMiddleware,
  requireAdmin,
  requirePermission("wallets.adjust"),
  async (req, res) => {
    try {
      const receiver = String(req.body.receiver || process.env.TRON_TREASURY_ADDRESS || "").trim();
      const amount = Number(req.body.amount || process.env.TRONMAX_DEFAULT_ENERGY || 65000);
      const duration = String(req.body.duration || process.env.TRONMAX_DEFAULT_DURATION || "15m");

      if (!receiver) {
        return res.status(400).json({ message: "Receiver address is required" });
      }

      const result = await rentTronEnergy({
        receiver,
        amount,
        duration,
        purpose: "manual_admin_test",
      });

      return res.json({
        message: "TronMax energy rental requested",
        result,
      });
    } catch (err) {
      console.error("tronmax rent energy error:", err);
      return res.status(500).json({
        message: err.message || "Failed to rent TRON energy",
      });
    }
  }
);



module.exports = router;