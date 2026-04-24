const express = require("express");

const router = express.Router();

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");
const authMiddleware = require("../middlewares/auth.middleware");
const { generateOTP } = require("../utils/otp");
const {
  sendWhatsAppOTP,
  USE_MOCK_OTP,
  MOCK_OTP,
} = require("../services/whatsapp.service");
const bcrypt = require("bcrypt");

// You can keep your currencies here
const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];
const OTP_EXPIRY_MINUTES = 5;

function normalizePhone(raw) {
  const p = String(raw || "").trim();
  const digits = p.replace(/\D/g, "");

  if (!digits) return "";

  if (p.startsWith("+")) {
    return "+" + digits;
  }

  return "+" + digits;
}

function mapAccountTypeToRole(accountType) {
  const value = String(accountType || "").trim().toLowerCase();

  if (value === "agent") return "agent";
  if (value === "merchant") return "merchant";
  return "user";
}

function normalizeReferralCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "JZ";

  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

async function generateUniqueReferralCode(fullName, phone) {
  for (let i = 0; i < 10; i++) {
    const candidate = generateReferralCode();

    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("referral_code", candidate)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return candidate;
    }
  }

  throw new Error("Failed to generate unique referral code");
}

async function seedWalletsForUser(userId) {
  const seedRows = DEFAULT_CURRENCIES.map((currency) => ({
    user_id: userId,
    currency,
    balance: 0,
  }));

  const { error } = await supabase.from("wallets").insert(seedRows);

  if (error) {
    throw error;
  }
}

async function createAndSendOtp(phone, purpose) {
  const code = USE_MOCK_OTP ? MOCK_OTP : generateOTP();
  const expiresAt = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();

  await supabase
    .from("otp_codes")
    .delete()
    .eq("phone", phone)
    .eq("purpose", purpose);

  await supabase.from("otp_codes").insert({
    phone,
    purpose,
    code,
    expires_at: expiresAt,
  });

  if (USE_MOCK_OTP) {
    console.log("🧪 MOCK OTP MODE ENABLED");
    console.log(`📲 Mock OTP for ${phone} (${purpose}): ${code}`);
    console.log("📵 WhatsApp skipped (mock mode)");
    return;
  }

  await sendWhatsAppOTP(phone, code);
}

async function verifyOtpCode(phone, purpose, code) {
  const { data, error } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("phone", phone)
    .eq("purpose", purpose)
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { ok: false, status: 401, message: "Invalid OTP" };
  }

  if (new Date(data.expires_at) < new Date()) {
    await supabase.from("otp_codes").delete().eq("id", data.id);
    return { ok: false, status: 400, message: "OTP expired" };
  }

  const { error: deleteErr } = await supabase
    .from("otp_codes")
    .delete()
    .eq("id", data.id);

  if (deleteErr) {
    throw deleteErr;
  }

  return { ok: true };
}

async function processReferralReward({ refereeUserId, triggerEvent }) {
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

  if (settings.trigger_event !== triggerEvent) {
    return {
      status: "skipped",
      reason: `trigger is ${settings.trigger_event}, not ${triggerEvent}`,
    };
  }

  const rewardAmount = Number(settings.reward_amount || 0);
  const currency = String(settings.currency || "USDT").trim().toUpperCase();

  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    return { status: "skipped", reason: "invalid reward amount" };
  }

  const { data: referee, error: refereeErr } = await supabase
    .from("users")
    .select("id, referred_by_user_id")
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
    .eq("trigger_event", triggerEvent)
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
      return { status: "skipped", reason: "max rewards reached" };
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
        trigger_event: triggerEvent,
        status: "pending",
      },
    ])
    .select()
    .single();

  if (rewardInsertErr) throw rewardInsertErr;

  let { data: wallet, error: walletErr } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("user_id", referrerUserId)
    .eq("currency", currency)
    .maybeSingle();

  if (walletErr) throw walletErr;

  if (!wallet) {
    const created = await supabase
      .from("wallets")
      .insert([{ user_id: referrerUserId, currency, balance: 0 }])
      .select("id, balance")
      .single();

    if (created.error) throw created.error;
    wallet = created.data;
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

  const { error: rewardUpdateErr } = await supabase
    .from("referral_rewards")
    .update({
      status: "rewarded",
      rewarded_at: new Date().toISOString(),
    })
    .eq("id", reward.id);

  if (rewardUpdateErr) throw rewardUpdateErr;

  return {
    status: "rewarded",
    rewardId: reward.id,
    amount: rewardAmount,
    currency,
    transactionId: tx.id,
    reference,
  };
}

// =====================================
// SIGNUP OTP REQUEST
// =====================================
router.post("/signup/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const fullName = String(req.body.fullName || "").trim();
    const password = String(req.body.password || "");
    const accountType = String(req.body.accountType || "").trim();
    const countryCode = String(req.body.countryCode || "").trim();
    const termsAccepted = !!req.body.termsAccepted;
    const referralCode = normalizeReferralCode(req.body.referralCode);

    if (!phone || !fullName || !password || !accountType || !countryCode) {
      return res.status(400).json({
        message: "phone, fullName, password, accountType and countryCode are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    if (!termsAccepted) {
      return res.status(400).json({
        message: "Terms must be accepted",
      });
    }

    const { data: existingUser, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone_verified")
      .eq("phone", phone)
      .maybeSingle();

    if (fetchErr) {
      console.error("signup/request-otp user lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (existingUser && existingUser.phone_verified) {
      return res.status(409).json({
        message: "Account already exists. Please login.",
      });
    }

    if (referralCode) {
      const { data: referrer, error: referrerErr } = await supabase
        .from("users")
        .select("id, phone, referral_code")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrerErr) {
        console.error("signup/request-otp referral lookup error:", referrerErr);
        return res.status(500).json({ message: "Referral lookup failed" });
      }

      if (!referrer) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      if (referrer.phone === phone) {
        return res.status(400).json({ message: "You cannot use your own referral code" });
      }
    }

    await createAndSendOtp(phone, "signup");

    return res.json({
      message: "OTP sent",
    });
  } catch (err) {
    console.error("signup/request-otp crash:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
});

// =====================================
// SIGNUP OTP VERIFY
// =====================================
router.post("/signup/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const fullName = String(req.body.fullName || "").trim();
    const otp = String(req.body.otp || "").trim();
    const password = String(req.body.password || "");
    const accountType = String(req.body.accountType || "").trim();
    const countryCode = String(req.body.countryCode || "").trim();
    const termsAccepted = !!req.body.termsAccepted;
    const referralCode = normalizeReferralCode(req.body.referralCode);

    if (!phone || !fullName || !otp || !password || !accountType || !countryCode) {
      return res.status(400).json({
        message: "phone, fullName, otp, password, accountType and countryCode are required",
      });
    }

    if (!termsAccepted) {
      return res.status(400).json({
        message: "Terms must be accepted",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const otpCheck = await verifyOtpCode(phone, "signup", otp);
    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({ message: otpCheck.message });
    }

    let referrer = null;

    if (referralCode) {
      const { data: referrerData, error: referrerErr } = await supabase
        .from("users")
        .select("id, phone, referral_code")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrerErr) {
        console.error("signup/verify-otp referral lookup error:", referrerErr);
        return res.status(500).json({ message: "Referral lookup failed" });
      }

      if (!referrerData) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      if (referrerData.phone === phone) {
        return res.status(400).json({ message: "You cannot use your own referral code" });
      }

      referrer = referrerData;
    }

    const { data: existingUser, error: fetchErr } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (fetchErr) {
      console.error("signup/verify-otp user lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (existingUser && existingUser.phone_verified) {
      return res.status(409).json({
        message: "Account already exists. Please login.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const role = mapAccountTypeToRole(accountType);

    let user = existingUser;

    if (!user) {
      const { data: newUser, error: createErr } = await supabase
        .from("users")
        .insert([
          {
            phone,
            fullName,
            password_hash: passwordHash,
            phone_verified: true,
            account_type: accountType,
            country_code: countryCode,
            terms_accepted: termsAccepted,
            role,
            referral_code: await generateUniqueReferralCode(fullName, phone),
            referred_by_user_id: referrer?.id || null,
          },
        ])
        .select()
        .single();

      if (createErr) {
        console.error("signup/verify-otp create error:", createErr);
        return res.status(500).json({ message: "User creation failed" });
      }

      user = newUser;

      try {
        await seedWalletsForUser(user.id);
      } catch (seedErr) {
        console.error("signup/verify-otp wallet seed error:", seedErr);
        return res.status(500).json({ message: "Wallet seeding failed" });
      }
    } else {
      const { data: updatedUser, error: updateErr } = await supabase
        .from("users")
        .update({
          fullName,
          password_hash: passwordHash,
          phone_verified: true,
          account_type: accountType,
          country_code: countryCode,
          terms_accepted: termsAccepted,
          role,
          referred_by_user_id: user.referred_by_user_id || referrer?.id || null,
        })
        .eq("id", user.id)
        .select()
        .single();

      if (updateErr) {
        console.error("signup/verify-otp update error:", updateErr);
        return res.status(500).json({ message: "User update failed" });
      }

      user = updatedUser;

      const { data: existingWallets, error: walletsErr } = await supabase
        .from("wallets")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);

      if (walletsErr) {
        console.error("signup/verify-otp wallet lookup error:", walletsErr);
        return res.status(500).json({ message: "Wallet lookup failed" });
      }

      if (!existingWallets || existingWallets.length === 0) {
        try {
          await seedWalletsForUser(user.id);
        } catch (seedErr) {
          console.error("signup/verify-otp wallet seed error:", seedErr);
          return res.status(500).json({ message: "Wallet seeding failed" });
        }
      }
    }

    let referralReward = null;

try {
  referralReward = await processReferralReward({
    refereeUserId: user.id,
    triggerEvent: "signup_verified",
  });
} catch (rewardErr) {
  console.error("signup referral reward failed:", rewardErr);
}

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
    });

    return res.json({
      message: "Account created successfully",
      token,
      hasPin: !!user.pin_hash,
      isNewUser: true,
    });
  } catch (err) {
    console.error("signup/verify-otp crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// LOGIN WITH PHONE + PASSWORD
// =====================================
router.post("/login", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        message: "phone and password are required",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, phone, password_hash, pin_hash, role, phone_verified, is_active")
      .eq("phone", phone)
      .maybeSingle();

    if (error) {
      console.error("login lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user || !user.password_hash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.phone_verified) {
      return res.status(403).json({ message: "Phone number is not verified" });
    }

    if (user.is_active === false) {
      return res.status(403).json({ message: "Account is suspended" });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
    });

    return res.json({
      message: "Authenticated",
      token,
      hasPin: !!user.pin_hash,
      isNewUser: false,
    });
  } catch (err) {
    console.error("login crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// SET PIN
// =====================================
router.post("/set-pin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const pin = String(req.body?.pin ?? "").trim();

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized (no userId)" });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must be exactly 4 digits" });
    }

    if (
      pin === "0000" ||
      pin === "1111" ||
      pin === "1234" ||
      pin === "4321" ||
      /^(\d)\1{3}$/.test(pin)
    ) {
      return res.status(400).json({
        message: "Choose a stronger PIN",
      });
    }

    const pinHash = await bcrypt.hash(pin, 10);

    const { data, error } = await supabase
      .from("users")
      .update({
        pin_hash: pinHash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", userId)
      .select("id, phone, pin_hash")
      .maybeSingle();

    if (error) {
      console.error("[set-pin] supabase error:", error);
      return res.status(500).json({ message: "Failed to set PIN" });
    }

    if (!data) {
      console.error("[set-pin] update returned no row (user not found?) id:", userId);
      return res.status(404).json({ message: "User not found (pin not saved)" });
    }

    return res.json({ message: "PIN set successfully" });
  } catch (err) {
    console.error("[set-pin] crash:", err?.message, err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// VERIFY PIN
// =====================================
router.post("/verify-pin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const pin = String(req.body?.pin ?? "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.json({
        ok: false,
        code: "INVALID_PIN",
        message: "PIN must be exactly 4 digits",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("pin_hash, pin_failed_attempts, pin_locked_until")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      console.error("verify-pin lookup error:", error);
      return res.status(500).json({
        ok: false,
        code: "USER_LOOKUP_FAILED",
        message: "User lookup failed",
      });
    }

    if (!user.pin_hash) {
      return res.json({
        ok: false,
        code: "PIN_NOT_SET",
        message: "No transaction pin set for this account",
      });
    }

    if (user.pin_locked_until) {
      const lockedUntil = new Date(user.pin_locked_until);
      if (lockedUntil > new Date()) {
        return res.json({
          ok: false,
          code: "PIN_LOCKED",
          message: "PIN is temporarily locked. Please try again later.",
        });
      }
    }

    const match = await bcrypt.compare(pin, user.pin_hash);

    if (!match) {
      const failedAttempts = Number(user.pin_failed_attempts || 0) + 1;
      let updates = { pin_failed_attempts: failedAttempts };

      if (failedAttempts >= 5) {
        const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
        updates.pin_locked_until = lockUntil.toISOString();
        updates.pin_failed_attempts = 0;
      }

      await supabase.from("users").update(updates).eq("id", userId);

      return res.json({
        ok: false,
        code: "WRONG_PIN",
        message: "Wrong PIN",
      });
    }

    await supabase
      .from("users")
      .update({
        pin_failed_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", userId);

    return res.json({ ok: true });
  } catch (err) {
    console.error("verify-pin crash:", err);
    return res.status(500).json({
      ok: false,
      code: "SERVER_ERROR",
      message: "Internal server error",
    });
  }
});

// =====================================
// AUTHENTICATED USER
// =====================================
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: user, error } = await supabase
      .from("users")
      .select("id, phone, fullName, avatar_key, referral_code, referred_by_user_id, role, account_type, country_code, phone_verified, terms_accepted")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("auth/me lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    return res.json({
      message: "Authenticated",
      user: user || req.user,
    });
  } catch (err) {
    console.error("auth/me crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// FORGOT PASSWORD OTP REQUEST
// =====================================
router.post("/forgot-password/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone) {
      return res.status(400).json({ message: "Phone is required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, phone")
      .eq("phone", phone)
      .maybeSingle();

    if (error) {
      console.error("forgot-password/request-otp lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    await createAndSendOtp(phone, "forgot_password");

    return res.json({
      message: "OTP sent",
    });
  } catch (err) {
    console.error("forgot-password/request-otp crash:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
});

// =====================================
// FORGOT PASSWORD OTP VERIFY
// =====================================
router.post("/forgot-password/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const otp = String(req.body.otp || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({
        message: "phone, otp and newPassword are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const otpCheck = await verifyOtpCode(phone, "forgot_password", otp);
    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({ message: otpCheck.message });
    }

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone, pin_hash")
      .eq("phone", phone)
      .maybeSingle();

    if (fetchErr) {
      console.error("forgot-password/verify-otp lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const { error: updateErr } = await supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", user.id);

    if (updateErr) {
      console.error("forgot-password/verify-otp update error:", updateErr);
      return res.status(500).json({ message: "Failed to reset password" });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
    });

    return res.json({
      message: "Password reset successfully",
      token,
      hasPin: !!user.pin_hash,
      isNewUser: false,
    });
  } catch (err) {
    console.error("forgot-password/verify-otp crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// FORGOT PIN OTP REQUEST
// =====================================
router.post("/forgot-pin/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone) {
      return res.status(400).json({ message: "Phone is required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, phone")
      .eq("phone", phone)
      .maybeSingle();

    if (error) {
      console.error("forgot-pin/request-otp lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    await createAndSendOtp(phone, "forgot_pin");

    return res.json({
      message: "OTP sent",
    });
  } catch (err) {
    console.error("forgot-pin/request-otp crash:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
});

// =====================================
// FORGOT PIN OTP VERIFY
// =====================================
router.post("/forgot-pin/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const otp = String(req.body.otp || "").trim();

    if (!phone || !otp) {
      return res.status(400).json({
        message: "phone and otp are required",
      });
    }

    const otpCheck = await verifyOtpCode(phone, "forgot_pin", otp);
    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({ message: otpCheck.message });
    }

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone")
      .eq("phone", phone)
      .maybeSingle();

    if (fetchErr) {
      console.error("forgot-pin/verify-otp lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({
        pin_hash: null,
        pin_failed_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", user.id);

    if (updateErr) {
      console.error("forgot-pin/verify-otp update error:", updateErr);
      return res.status(500).json({ message: "Failed to reset PIN" });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
    });

    return res.json({
      message: "PIN reset successfully",
      token,
      hasPin: false,
      isNewUser: false,
    });
  } catch (err) {
    console.error("forgot-pin/verify-otp crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// UPDATE AVATAR
// =====================================
router.patch("/avatar", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const avatarKey = String(req.body?.avatarKey || "").trim();

    const allowedAvatars = [
      "avatar_1",
      "avatar_2",
      "avatar_3",
      "avatar_4",
      "avatar_5",
      "avatar_6",
    ];

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!allowedAvatars.includes(avatarKey)) {
      return res.status(400).json({ message: "Invalid avatar selection" });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ avatar_key: avatarKey })
      .eq("id", userId)
      .select("id, avatar_key")
      .maybeSingle();

    if (error) {
      console.error("auth/avatar update error:", error);
      return res.status(500).json({ message: "Failed to update avatar" });
    }

    if (!data) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      message: "Avatar updated successfully",
      avatarKey: data.avatar_key,
    });
  } catch (err) {
    console.error("auth/avatar crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/referrals/summary", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: invitedRows, error } = await supabase
      .from("users")
      .select("id, phone, fullName, phone_verified, created_at")
      .eq("referred_by_user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("referrals/summary error:", error);
      return res.status(500).json({ message: "Failed to load referral summary" });
    }

    const { data: rewards, error: rewardsErr } = await supabase
      .from("referral_rewards")
      .select("referee_user_id, reward_amount, currency, status")
      .eq("referrer_user_id", userId)
      .eq("status", "rewarded");

    if (rewardsErr) {
      console.error("referrals/summary rewards error:", rewardsErr);
      return res.status(500).json({ message: "Failed to load referral rewards" });
    }

    const rows = invitedRows || [];
    const rewardedRows = rewards || [];

    const invitedCount = rows.length;
    const successfulCount = rows.filter((u) => u.phone_verified).length;

    const currency = rewardedRows[0]?.currency || "USDT";

    const earnedAmount = rewardedRows.reduce(
      (sum, reward) => sum + Number(reward.reward_amount || 0),
      0
    );

    const rewardByRefereeId = new Map(
      rewardedRows.map((reward) => [
        reward.referee_user_id,
        {
          amount: Number(reward.reward_amount || 0),
          currency: reward.currency || "USDT",
        },
      ])
    );

    const history = rows.map((u) => {
      const reward = rewardByRefereeId.get(u.id);

      return {
        id: u.id,
        name: u.fullName || "JeezPay user",
        phone: maskPhone(u.phone),
        status: reward ? "rewarded" : u.phone_verified ? "successful" : "pending",
        rewardAmount: reward?.amount || 0,
        currency: reward?.currency || "USDT",
        joinedAt: u.created_at,
      };
    });

    return res.json({
      invitedCount,
      successfulCount,
      earnedAmount,
      currency,
      history,
    });
  } catch (err) {
    console.error("referrals/summary crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length <= 6) return value;

  return `${value.slice(0, 4)}****${value.slice(-3)}`;
}

module.exports = router;