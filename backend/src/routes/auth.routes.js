const express = require("express");

const router = express.Router();

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");
const authMiddleware = require("../middlewares/auth.middleware");
const { otpVerifyLimiter, pinVerifyLimiter } = require("../middlewares/rateLimit.middleware");
const {
  generateOTP,
  hashOTP,
  verifyOTPHash,
  secureRandomIndex,
} = require("../utils/otp");
const { sendEmailOTP,sendPasswordResetAlert,
  sendPinResetAlert,
  sendNewLoginAlert } = require("../services/email.service");
const bcrypt = require("bcrypt");

// You can keep your currencies here
const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

function normalizePhone(raw) {
  const p = String(raw || "").trim();
  const digits = p.replace(/\D/g, "");

  if (!digits) return "";

  if (p.startsWith("+")) {
    return "+" + digits;
  }

  return "+" + digits;
}
function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
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
    code += chars[secureRandomIndex(chars.length)];
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

  const { error } = await supabase
    .from("wallets")
    .upsert(seedRows, {
      onConflict: "user_id,currency",
      ignoreDuplicates: true,
    });

  if (error) {
    throw error;
  }
}

async function createAndSendOtp(email, purpose) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPurpose = String(purpose || "").trim().toLowerCase();
  const code = generateOTP();
  const codeHash = hashOTP({
    email: normalizedEmail,
    purpose: normalizedPurpose,
    code,
  });

  const expiresAt = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();

  const { error: deleteErr } = await supabase
    .from("otp_codes")
    .delete()
    .eq("email", normalizedEmail)
    .eq("purpose", normalizedPurpose);

  if (deleteErr) {
    console.error("[createAndSendOtp] delete error:", deleteErr);
    throw deleteErr;
  }

  const { error: insertErr } = await supabase.from("otp_codes").insert({
    email: normalizedEmail,
    purpose: normalizedPurpose,

    // Keep the legacy code column populated during the transition so the
    // schema remains compatible with the currently deployed backend.
    // Both values contain only the one-way HMAC, never the plaintext OTP.
    code: codeHash,
    code_hash: codeHash,
    attempt_count: 0,
    expires_at: expiresAt,
  });

  if (insertErr) {
    console.error("[createAndSendOtp] insert error:", insertErr);
    throw insertErr;
  }

  await sendEmailOTP(normalizedEmail, code);
}



async function verifyOtpCode(email, purpose, code) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPurpose = String(purpose || "").trim().toLowerCase();
  const normalizedCode = String(code || "").trim();

  if (!normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
    return {
      ok: false,
      status: 400,
      message: "A valid 6-digit OTP is required",
    };
  }

  const { data: otpRow, error } = await supabase
    .from("otp_codes")
    .select(
      "id, email, purpose, code, code_hash, attempt_count, expires_at"
    )
    .eq("email", normalizedEmail)
    .eq("purpose", normalizedPurpose)
    .maybeSingle();

  if (error) {
    console.error("[verifyOtpCode] lookup error:", error);
    return { ok: false, status: 500, message: "OTP lookup failed" };
  }

  if (!otpRow) {
    return { ok: false, status: 401, message: "Invalid OTP" };
  }

  if (Date.now() > new Date(otpRow.expires_at).getTime()) {
    await supabase.from("otp_codes").delete().eq("id", otpRow.id);

    return { ok: false, status: 401, message: "OTP expired" };
  }

  const storedCode = String(otpRow.code || "").trim();
  const storedHash = String(otpRow.code_hash || storedCode).trim();

  // Temporary compatibility for OTP challenges created by the old backend
  // during a rolling deployment. They expire within five minutes.
  const isLegacyPlaintext =
    !otpRow.code_hash && /^\d{6}$/.test(storedCode);

  const matches = isLegacyPlaintext
    ? storedCode === normalizedCode
    : verifyOTPHash({
        storedHash,
        email: normalizedEmail,
        purpose: normalizedPurpose,
        code: normalizedCode,
      });

  if (!matches) {
    const currentAttemptCount = Number(otpRow.attempt_count || 0);
    const nextAttemptCount = currentAttemptCount + 1;

    if (nextAttemptCount >= MAX_OTP_ATTEMPTS) {
      const { error: deleteErr } = await supabase
        .from("otp_codes")
        .delete()
        .eq("id", otpRow.id);

      if (deleteErr) {
        console.error("[verifyOtpCode] attempt delete error:", deleteErr);
        return {
          ok: false,
          status: 500,
          message: "OTP verification failed",
        };
      }

      return {
        ok: false,
        status: 429,
        message: "Too many invalid OTP attempts. Request a new code.",
      };
    }

    const { error: attemptErr } = await supabase
      .from("otp_codes")
      .update({ attempt_count: nextAttemptCount })
      .eq("id", otpRow.id);

    if (attemptErr) {
      console.error("[verifyOtpCode] attempt update error:", attemptErr);
      return {
        ok: false,
        status: 500,
        message: "OTP verification failed",
      };
    }

    return { ok: false, status: 401, message: "Invalid OTP" };
  }

  // Conditional consumption makes a valid OTP single-use even when two
  // verification requests arrive almost simultaneously.
  const { data: consumedOtp, error: consumeErr } = await supabase
    .from("otp_codes")
    .delete()
    .eq("id", otpRow.id)
    .select("id")
    .maybeSingle();

  if (consumeErr) {
    console.error("[verifyOtpCode] consume error:", consumeErr);
    return {
      ok: false,
      status: 500,
      message: "OTP verification failed",
    };
  }

  if (!consumedOtp) {
    return {
      ok: false,
      status: 401,
      message: "OTP already used or expired",
    };
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

  if (settingsErr) {
    console.error("[REFERRAL] settings fetch failed:", settingsErr);
    throw settingsErr;
  }



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

  if (refereeErr) {
    console.error("[REFERRAL] referee fetch failed:", refereeErr);
    throw refereeErr;
  }



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

  if (existingRewardErr) {
    console.error("[REFERRAL] existing reward lookup failed:", existingRewardErr);
    throw existingRewardErr;
  }

  

  if (existingReward) {
    return {
      status: "skipped",
      reason: "reward already exists",
      rewardId: existingReward.id,
      existingStatus: existingReward.status,
    };
  }

  const maxRewardsPerUser = Number(settings.max_rewards_per_user || 0);

  if (maxRewardsPerUser > 0) {
    const { count, error: countErr } = await supabase
      .from("referral_rewards")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", referrerUserId)
      .eq("status", "rewarded");

    if (countErr) {
      console.error("[REFERRAL] reward count failed:", countErr);
      throw countErr;
    }

    

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

  if (rewardInsertErr) {
    console.error("[REFERRAL] reward insert failed:", rewardInsertErr);
    throw rewardInsertErr;
  }

 

  let { data: wallet, error: walletErr } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("user_id", referrerUserId)
    .eq("currency", currency)
    .maybeSingle();

  if (walletErr) {
    console.error("[REFERRAL] wallet fetch failed:", walletErr);
    throw walletErr;
  }

 

  if (!wallet) {
    const created = await supabase
      .from("wallets")
      .insert([{ user_id: referrerUserId, currency, balance: 0 }])
      .select("id, balance")
      .single();

    if (created.error) {
      console.error("[REFERRAL] wallet create failed:", created.error);
      throw created.error;
    }

    wallet = created.data;
    
  }

  const oldBalance = Number(wallet.balance || 0);
  const newBalance = oldBalance + rewardAmount;

  

  const { error: walletUpdateErr } = await supabase
    .from("wallets")
    .update({ balance: newBalance })
    .eq("id", wallet.id);

  if (walletUpdateErr) {
    console.error("[REFERRAL] wallet update failed:", walletUpdateErr);
    throw walletUpdateErr;
  }

  const reference = Date.now();

  

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

  if (txErr) {
    console.error("[REFERRAL] transaction insert failed:", txErr);
    throw txErr;
  }

 

  const { data: updatedReward, error: rewardUpdateErr } = await supabase
    .from("referral_rewards")
    .update({
      status: "rewarded",
      rewarded_at: new Date().toISOString(),
    })
    .eq("id", reward.id)
    .select()
    .single();

  if (rewardUpdateErr) {
    console.error("[REFERRAL] reward update failed:", rewardUpdateErr);
    throw rewardUpdateErr;
  }

  

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
// Email OTP verification, phone is still saved as contact/account number
// =====================================
router.post("/signup/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const fullName = String(req.body.fullName || "").trim();
    const password = String(req.body.password || "");
    const accountType = String(req.body.accountType || "").trim();
    const countryCode = String(req.body.countryCode || "").trim();
    const termsAccepted = !!req.body.termsAccepted;
    const referralCode = normalizeReferralCode(req.body.referralCode);

    if (!fullName) {
      return res.status(400).json({ message: "Full name is required" });
    }

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    if (!phone) {
      return res.status(400).json({ message: "Phone is required" });
    }

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    if (!accountType) {
      return res.status(400).json({ message: "Account type is required" });
    }

    if (!countryCode) {
      return res.status(400).json({ message: "Country code is required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
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

    const { data: existingByEmail, error: emailLookupErr } = await supabase
      .from("users")
      .select("id, email, email_verified")
      .eq("email", email)
      .maybeSingle();

    if (emailLookupErr) {
      console.error("signup/request-otp email lookup error:", emailLookupErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (existingByEmail && existingByEmail.email_verified) {
      return res.status(409).json({
        message: "Account already exists with this email. Please login.",
      });
    }

    const { data: existingByPhone, error: phoneLookupErr } = await supabase
      .from("users")
      .select("id, phone, email_verified")
      .eq("phone", phone)
      .maybeSingle();

    if (phoneLookupErr) {
      console.error("signup/request-otp phone lookup error:", phoneLookupErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (existingByPhone && existingByPhone.email_verified) {
      return res.status(409).json({
        message: "Account already exists with this phone. Please login.",
      });
    }

    if (referralCode) {
      const { data: referrer, error: referrerErr } = await supabase
        .from("users")
        .select("id, phone, email, referral_code")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrerErr) {
        console.error("signup/request-otp referral lookup error:", referrerErr);
        return res.status(500).json({ message: "Referral lookup failed" });
      }

      if (!referrer) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      if (referrer.phone === phone || referrer.email === email) {
        return res.status(400).json({
          message: "You cannot use your own referral code",
        });
      }
    }

    await createAndSendOtp(email, "signup");

    return res.json({
      message: "Verification code sent to your email",
    });
  } catch (err) {
    console.error("signup/request-otp crash:", err);
    return res.status(500).json({ message: "Failed to send verification code" });
  }
});

// =====================================
// SIGNUP OTP VERIFY
// =====================================
router.post("/signup/verify-otp", otpVerifyLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const fullName = String(req.body.fullName || "").trim();
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    const password = String(req.body.password || "");
    const accountType = String(req.body.accountType || "").trim();
    const countryCode = String(req.body.countryCode || "").trim();
    const termsAccepted = !!req.body.termsAccepted;
    const referralCode = normalizeReferralCode(req.body.referralCode);

    if (
      !phone ||
      !fullName ||
      !email ||
      !otp ||
      !password ||
      !accountType ||
      !countryCode
    ) {
      return res.status(400).json({
        message:
          "phone, fullName, email, otp, password, accountType and countryCode are required",
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

    // VERIFY OTP USING EMAIL
    const otpCheck = await verifyOtpCode(email, "signup", otp);

    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({
        message: otpCheck.message,
      });
    }

    let referrer = null;

    if (referralCode) {
      const { data: referrerData, error: referrerErr } = await supabase
        .from("users")
        .select("id, phone, email, referral_code")
        .eq("referral_code", referralCode)
        .maybeSingle();

      if (referrerErr) {
        console.error(
          "signup/verify-otp referral lookup error:",
          referrerErr
        );

        return res.status(500).json({
          message: "Referral lookup failed",
        });
      }

      if (!referrerData) {
        return res.status(400).json({
          message: "Invalid referral code",
        });
      }

      if (
        referrerData.phone === phone ||
        referrerData.email === email
      ) {
        return res.status(400).json({
          message: "You cannot use your own referral code",
        });
      }

      referrer = referrerData;
    }

    // CHECK EXISTING USER BY EMAIL
    const { data: existingByEmail, error: emailLookupErr } =
      await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .maybeSingle();

    if (emailLookupErr) {
      console.error(
        "signup/verify-otp email lookup error:",
        emailLookupErr
      );

      return res.status(500).json({
        message: "User lookup failed",
      });
    }

    if (existingByEmail && existingByEmail.email_verified) {
      return res.status(409).json({
        message: "Account already exists. Please login.",
      });
    }

    // CHECK EXISTING USER BY PHONE
    const { data: existingByPhone, error: phoneLookupErr } =
      await supabase
        .from("users")
        .select("*")
        .eq("phone", phone)
        .maybeSingle();

    if (phoneLookupErr) {
      console.error(
        "signup/verify-otp phone lookup error:",
        phoneLookupErr
      );

      return res.status(500).json({
        message: "User lookup failed",
      });
    }

    if (existingByPhone && existingByPhone.email_verified) {
      return res.status(409).json({
        message: "Account already exists. Please login.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const role = mapAccountTypeToRole(accountType);

    let user = existingByEmail || existingByPhone;

    // CREATE USER
    if (!user) {
      const { data: newUser, error: createErr } = await supabase
        .from("users")
        .insert([
          {
            phone,
            email,
            fullName,
            password_hash: passwordHash,

            // Signup currently proves email ownership only.
            phone_verified: false,
            email_verified: true,

            account_type: accountType,
            country_code: countryCode,
            terms_accepted: termsAccepted,
            role,

            referral_code:
              await generateUniqueReferralCode(
                fullName,
                phone
              ),

            referred_by_user_id:
              referrer?.id || null,
          },
        ])
        .select()
        .single();

      if (createErr) {
        console.error(
          "signup/verify-otp create error:",
          createErr
        );

        return res.status(500).json({
          message: "User creation failed",
        });
      }

      user = newUser;

      try {
        await seedWalletsForUser(user.id);
      } catch (seedErr) {
        console.error(
          "signup/verify-otp wallet seed error:",
          seedErr
        );

        return res.status(500).json({
          message: "Wallet seeding failed",
        });
      }
    } else {
      // UPDATE EXISTING USER
      const { data: updatedUser, error: updateErr } =
        await supabase
          .from("users")
          .update({
            phone,
            email,
            fullName,
            password_hash: passwordHash,

            phone_verified: false,
            email_verified: true,

            account_type: accountType,
            country_code: countryCode,
            terms_accepted: termsAccepted,
            role,

            referred_by_user_id:
              user.referred_by_user_id ||
              referrer?.id ||
              null,
          })
          .eq("id", user.id)
          .select()
          .single();

      if (updateErr) {
        console.error(
          "signup/verify-otp update error:",
          updateErr
        );

        return res.status(500).json({
          message: "User update failed",
        });
      }

      user = updatedUser;

      const { data: existingWallets, error: walletsErr } =
        await supabase
          .from("wallets")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);

      if (walletsErr) {
        console.error(
          "signup/verify-otp wallet lookup error:",
          walletsErr
        );

        return res.status(500).json({
          message: "Wallet lookup failed",
        });
      }

      if (!existingWallets || existingWallets.length === 0) {
        try {
          await seedWalletsForUser(user.id);
        } catch (seedErr) {
          console.error(
            "signup/verify-otp wallet seed error:",
            seedErr
          );

          return res.status(500).json({
            message: "Wallet seeding failed",
          });
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
      console.error(
        "signup referral reward failed:",
        rewardErr
      );
    }

    

    const deviceName =
      req.headers["x-device-name"] ||
      req.body.deviceName ||
      "Unknown device";

    const appPlatform =
      req.headers["x-app-platform"] ||
      req.body.appPlatform ||
      "android";

    const userAgent =
      req.headers["user-agent"] || "";

    const ipAddress =
      req.headers["x-forwarded-for"]
        ?.split(",")[0]
        ?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const { data: sessionRow, error: sessionErr } =
      await supabase
        .from("user_sessions")
        .insert({
          user_id: user.id,
          device_name: deviceName,
          device_type: "mobile",
          app_platform: appPlatform,
          ip_address: ipAddress,
          user_agent: userAgent,
        })
        .select("id")
        .single();

    if (sessionErr || !sessionRow) {
      console.error(
        "[signup] session create error:",
        sessionErr
      );

      return res.status(500).json({
        message: "Failed to create session",
      });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
      sessionId: sessionRow.id,
    });

    return res.json({
      message: "Account created successfully",
      token,
      hasPin: !!user.pin_hash,
      isNewUser: true,
      referralReward,
    });
  } catch (err) {
    console.error("signup/verify-otp crash:", err);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// =====================================
// LOGIN WITH PHONE + PASSWORD
// =====================================
router.post("/login", async (req, res) => {
  try {
    const rawIdentifier = String(
      req.body.identifier || req.body.email || req.body.phone || ""
    ).trim();

    const password = String(req.body.password || "");

    if (!rawIdentifier || !password) {
      return res.status(400).json({
        message: "Email/phone and password are required",
      });
    }

    const isEmail = rawIdentifier.includes("@");
    const identifier = isEmail
      ? normalizeEmail(rawIdentifier)
      : normalizePhone(rawIdentifier);

    const lookupColumn = isEmail ? "email" : "phone";

    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, phone, email, password_hash, pin_hash, role, phone_verified, email_verified, is_active"
      )
      .eq(lookupColumn, identifier)
      .maybeSingle();

    if (error) {
      console.error("login lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user || !user.password_hash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (isEmail && !user.email_verified) {
      return res.status(403).json({
        message: "Email is not verified",
      });
    }

    if (!isEmail && !user.phone_verified) {
      return res.status(403).json({
        message: "Phone is not verified. Sign in with your email.",
      });
    }

    if (user.is_active === false) {
      return res.status(403).json({ message: "Account is suspended" });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const deviceName =
      req.headers["x-device-name"] ||
      req.body.deviceName ||
      "Unknown device";

    const appPlatform =
      req.headers["x-app-platform"] ||
      req.body.appPlatform ||
      "android";

    const userAgent = req.headers["user-agent"] || "";

    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const { data: sessionRow, error: sessionErr } = await supabase
      .from("user_sessions")
      .insert({
        user_id: user.id,
        device_name: deviceName,
        device_type: "mobile",
        app_platform: appPlatform,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (sessionErr || !sessionRow) {
      console.error("[login] session create error:", sessionErr);
      return res.status(500).json({ message: "Failed to create session" });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
      email: user.email,
      sessionId: sessionRow.id,
    });

    if (user.email) {
  sendNewLoginAlert(
    user.email,
    deviceName,
    ipAddress
  ).catch(err =>
    console.error("new login alert email failed:", err)
  );
}

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
// CHANGE PIN
// =====================================
router.post("/change-pin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const currentPin = String(req.body?.currentPin ?? "").trim();
    const newPin = String(req.body?.newPin ?? "").trim();

    if (!userId) return res.status(401).json({ message: "Unauthorized (no userId)" });

    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ message: "PIN must be exactly 4 digits" });
    }

    if (currentPin === newPin) {
      return res.status(400).json({ message: "New PIN must be different from current PIN" });
    }

    if (["0000", "1111", "1234", "4321"].includes(newPin) || /^(\d)\1{3}$/.test(newPin)) {
      return res.status(400).json({ message: "Choose a stronger PIN" });
    }

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, pin_hash, pin_failed_attempts, pin_locked_until, email")
      .eq("id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[change-pin] user lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.pin_hash) {
      return res.status(400).json({ message: "No PIN is set for this account" });
    }

    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
      return res.status(423).json({
        message: "PIN is temporarily locked. Please try again later.",
      });
    }

    const currentPinMatches = await bcrypt.compare(currentPin, user.pin_hash);

    if (!currentPinMatches) {
      const failedAttempts = Number(user.pin_failed_attempts || 0) + 1;

      const updates = { pin_failed_attempts: failedAttempts };

      if (failedAttempts >= 5) {
        updates.pin_failed_attempts = 0;
        updates.pin_locked_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      }

      await supabase.from("users").update(updates).eq("id", userId);

      return res.status(400).json({ message: "Current PIN is incorrect" });
    }

    const newPinHash = await bcrypt.hash(newPin, 10);

    const { data: updatedUser, error: updateErr } = await supabase
      .from("users")
      .update({
        pin_hash: newPinHash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", userId)
      .select("id, pin_hash")
      .maybeSingle();

    if (updateErr) {
      console.error("[change-pin] update error:", updateErr);
      return res.status(500).json({ message: "Failed to change PIN" });
    }

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    if (user.email) {
      sendPinResetAlert(user.email).catch((err) =>
        console.error("change-pin alert email failed:", err)
      );
    }

    return res.json({
      message: "PIN changed successfully",
      hasPin: true,
    });
  } catch (err) {
    console.error("[change-pin] crash:", err?.message, err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// CHANGE PASSWORD
// =====================================
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const currentPassword = String(req.body?.currentPassword ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? "").trim();

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, password_hash, email")
      .eq("id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[change-password] user lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.password_hash) {
      return res.status(400).json({
        message: "Password is not set for this account",
      });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.password_hash);

    if (!passwordMatches) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    const { error: updateErr } = await supabase
      .from("users")
      .update({
        password_hash: newPasswordHash,
        password_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateErr) {
      console.error("[change-password] update error:", updateErr);
      return res.status(500).json({ message: "Failed to change password" });
    }

    if (user.email) {
      sendPasswordResetAlert(user.email).catch((err) =>
        console.error("change-password alert email failed:", err)
      );
    }

    return res.json({
      message: "Password changed successfully",
    });
  } catch (err) {
    console.error("[change-password] crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/change-email/request-otp", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const newEmail = normalizeEmail(req.body.newEmail);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!newEmail) {
      return res.status(400).json({ message: "New email is required" });
    }

    const { data: currentUser, error: currentErr } = await supabase
      .from("users")
      .select("id, email")
      .eq("id", userId)
      .maybeSingle();

    if (currentErr) {
      console.error("[change-email/request-otp] current user lookup error:", currentErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (currentUser.email === newEmail) {
      return res.status(400).json({
        message: "New email must be different from current email",
      });
    }

    const { data: existingUser, error: existingErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", newEmail)
      .maybeSingle();

    if (existingErr) {
      console.error("[change-email/request-otp] existing email lookup error:", existingErr);
      return res.status(500).json({ message: "Email lookup failed" });
    }

    if (existingUser) {
      return res.status(409).json({
        message: "This email is already used by another account",
      });
    }

    await createAndSendOtp(newEmail, "change_email");

    return res.json({
      message: "Verification code sent to your new email",
    });
  } catch (err) {
    console.error("[change-email/request-otp] crash:", err);
    return res.status(500).json({ message: "Failed to send verification code" });
  }
});

router.post("/change-email/verify-otp", authMiddleware, otpVerifyLimiter, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const newEmail = normalizeEmail(req.body.newEmail);
    const otp = String(req.body.otp || "").trim();

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!newEmail || !otp) {
      return res.status(400).json({
        message: "New email and OTP are required",
      });
    }

    const otpCheck = await verifyOtpCode(newEmail, "change_email", otp);

    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({
        message: otpCheck.message,
      });
    }

    const { data: existingUser, error: existingErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", newEmail)
      .neq("id", userId)
      .maybeSingle();

    if (existingErr) {
      console.error("[change-email/verify-otp] existing email lookup error:", existingErr);
      return res.status(500).json({ message: "Email lookup failed" });
    }

    if (existingUser) {
      return res.status(409).json({
        message: "This email is already used by another account",
      });
    }

    const { data: updatedUser, error: updateErr } = await supabase
      .from("users")
      .update({
        email: newEmail,
        email_verified: true,
      })
      .eq("id", userId)
      .select("id, email")
      .maybeSingle();

    if (updateErr) {
      console.error("[change-email/verify-otp] update error:", updateErr);
      return res.status(500).json({ message: "Failed to change email" });
    }

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      message: "Email changed successfully",
      email: updatedUser.email,
      emailVerified: true,
    });
  } catch (err) {
    console.error("[change-email/verify-otp] crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// VERIFY PIN
// =====================================
router.post("/verify-pin", authMiddleware, pinVerifyLimiter, async (req, res) => {
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
      .select("id, phone, email, fullName, avatar_key, referral_code, referred_by_user_id, role, account_type, country_code, phone_verified,email_verified, terms_accepted, wallet_account_number")
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
    const rawIdentifier = String(
      req.body.identifier || req.body.email || req.body.phone || ""
    ).trim();

    if (!rawIdentifier) {
      return res.status(400).json({
        message: "Email or phone is required",
      });
    }

    const isEmail = rawIdentifier.includes("@");
    const identifier = isEmail
      ? normalizeEmail(rawIdentifier)
      : normalizePhone(rawIdentifier);

    const lookupColumn = isEmail ? "email" : "phone";

    const { data: user, error } = await supabase
      .from("users")
      .select("id, phone, email, email_verified, phone_verified")
      .eq(lookupColumn, identifier)
      .maybeSingle();

    if (error) {
      console.error("forgot-password/request-otp lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (!user.email) {
      return res.status(400).json({
        message: "No email is linked to this account",
      });
    }

    if (!user.email_verified) {
      return res.status(403).json({
        message: "Verified email is required for account recovery",
      });
    }

    await createAndSendOtp(user.email, "forgot_password");

    return res.json({
      message: "Verification code sent to your email",
    });
  } catch (err) {
    console.error("forgot-password/request-otp crash:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
});

// =====================================
// FORGOT PASSWORD OTP VERIFY
// =====================================
router.post("/forgot-password/verify-otp", otpVerifyLimiter, async (req, res) => {
  try {
    const rawIdentifier = String(
      req.body.identifier || req.body.email || req.body.phone || ""
    ).trim();

    const otp = String(req.body.otp || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!rawIdentifier || !otp || !newPassword) {
      return res.status(400).json({
        message: "Email/phone, OTP and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const isEmail = rawIdentifier.includes("@");
    const identifier = isEmail
      ? normalizeEmail(rawIdentifier)
      : normalizePhone(rawIdentifier);

    const lookupColumn = isEmail ? "email" : "phone";

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone, email, pin_hash")
      .eq(lookupColumn, identifier)
      .maybeSingle();

    if (fetchErr) {
      console.error("forgot-password/verify-otp lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (!user.email) {
      return res.status(400).json({
        message:
          "This account has no email linked. Please reset using phone OTP when available.",
      });
    }

    const otpCheck = await verifyOtpCode(user.email, "forgot_password", otp);

    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({
        message: otpCheck.message,
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const { error: updateErr } = await supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", user.id);

    if (updateErr) {
      console.error("forgot-password/verify-otp update error:", updateErr);
      return res.status(500).json({
        message: "Failed to reset password",
      });
    }
    try {
  await sendPasswordResetAlert(user.email);
} catch (e) {
  console.error("password reset alert email failed:", e);
}

    const deviceName =
      req.headers["x-device-name"] ||
      req.body.deviceName ||
      "Unknown device";

    const appPlatform =
      req.headers["x-app-platform"] ||
      req.body.appPlatform ||
      "android";

    const userAgent = req.headers["user-agent"] || "";

    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const { data: sessionRow, error: sessionErr } = await supabase
      .from("user_sessions")
      .insert({
        user_id: user.id,
        device_name: deviceName,
        device_type: "mobile",
        app_platform: appPlatform,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (sessionErr || !sessionRow) {
      console.error("[forgot-password] session create error:", sessionErr);
      return res.status(500).json({
        message: "Failed to create session",
      });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
      email: user.email,
      sessionId: sessionRow.id,
    });

    return res.json({
      message: "Password reset successfully",
      token,
      hasPin: !!user.pin_hash,
      isNewUser: false,
    });
  } catch (err) {
    console.error("forgot-password/verify-otp crash:", err);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// =====================================
// FORGOT PIN OTP REQUEST
// =====================================
router.post("/forgot-pin/request-otp", async (req, res) => {
  try {
    const rawIdentifier = String(
      req.body.identifier || req.body.email || req.body.phone || ""
    ).trim();

    if (!rawIdentifier) {
      return res.status(400).json({
        message: "Email or phone is required",
      });
    }

    const isEmail = rawIdentifier.includes("@");
    const identifier = isEmail
      ? normalizeEmail(rawIdentifier)
      : normalizePhone(rawIdentifier);

    const lookupColumn = isEmail ? "email" : "phone";

    const { data: user, error } = await supabase
      .from("users")
      .select("id, phone, email, email_verified, phone_verified")
      .eq(lookupColumn, identifier)
      .maybeSingle();

    if (error) {
      console.error("forgot-pin/request-otp lookup error:", error);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (!user.email) {
      return res.status(400).json({
        message:
          "This account has no email linked. Please reset PIN using phone OTP when available.",
      });
    }

    if (!user.email_verified) {
      return res.status(403).json({
        message: "Verified email is required for account recovery",
      });
    }

    await createAndSendOtp(user.email, "forgot_pin");

    return res.json({
      message: "Verification code sent to your email",
    });
  } catch (err) {
    console.error("forgot-pin/request-otp crash:", err);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
});

// =====================================
// FORGOT PIN OTP VERIFY
// =====================================
router.post("/forgot-pin/verify-otp", otpVerifyLimiter, async (req, res) => {
  try {
    const rawIdentifier = String(
      req.body.identifier || req.body.email || req.body.phone || ""
    ).trim();

    const otp = String(req.body.otp || "").trim();

    if (!rawIdentifier || !otp) {
      return res.status(400).json({
        message: "Email/phone and OTP are required",
      });
    }

    const isEmail = rawIdentifier.includes("@");
    const identifier = isEmail
      ? normalizeEmail(rawIdentifier)
      : normalizePhone(rawIdentifier);

    const lookupColumn = isEmail ? "email" : "phone";

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, phone, email")
      .eq(lookupColumn, identifier)
      .maybeSingle();

    if (fetchErr) {
      console.error("forgot-pin/verify-otp lookup error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (!user.email) {
      return res.status(400).json({
        message:
          "This account has no email linked. Please reset PIN using phone OTP when available.",
      });
    }

    const otpCheck = await verifyOtpCode(user.email, "forgot_pin", otp);

    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({
        message: otpCheck.message,
      });
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
    try {
  await sendPinResetAlert(user.email);
} catch (e) {
  console.error("pin reset alert email failed:", e);
}

    const deviceName =
      req.headers["x-device-name"] ||
      req.body.deviceName ||
      "Unknown device";

    const appPlatform =
      req.headers["x-app-platform"] ||
      req.body.appPlatform ||
      "android";

    const userAgent = req.headers["user-agent"] || "";

    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const { data: sessionRow, error: sessionErr } = await supabase
      .from("user_sessions")
      .insert({
        user_id: user.id,
        device_name: deviceName,
        device_type: "mobile",
        app_platform: appPlatform,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (sessionErr || !sessionRow) {
      console.error("[forgot-pin] session create error:", sessionErr);
      return res.status(500).json({ message: "Failed to create session" });
    }

    const token = generateToken({
      userId: user.id,
      phone: user.phone,
      email: user.email,
      sessionId: sessionRow.id,
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
      .select(
        "id, phone, fullName, phone_verified, email_verified, created_at"
      )
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
    const successfulCount = rows.filter(
      (u) => u.email_verified || u.phone_verified
    ).length;

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
        status: reward
          ? "rewarded"
          : u.email_verified || u.phone_verified
            ? "successful"
            : "pending",
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

// =====================================
// ACTIVE SESSIONS
// =====================================
router.get("/sessions", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;

    const { data, error } = await supabase
      .from("user_sessions")
      .select("id, device_name, device_type, app_platform, ip_address, last_seen_at, created_at, revoked_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false });

    if (error) {
      console.error("[sessions] list error:", error);
      return res.status(500).json({ message: "Failed to load sessions" });
    }

    const sessions = (data || []).map((s) => ({
      id: s.id,
      deviceName: s.device_name || "Unknown device",
      deviceType: s.device_type || "mobile",
      appPlatform: s.app_platform || "android",
      ipAddress: s.ip_address,
      lastSeenAt: s.last_seen_at,
      createdAt: s.created_at,
      isCurrent: currentSessionId ? s.id === currentSessionId : false,
    }));

    return res.json({ sessions });
  } catch (err) {
    console.error("[sessions] crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/sessions/:sessionId", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;
    const sessionId = req.params.sessionId;

    if (sessionId === currentSessionId) {
      return res.status(400).json({
        message: "You cannot revoke the current session from here",
      });
    }

    const { error } = await supabase
      .from("user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", userId);

    if (error) {
      console.error("[sessions] revoke error:", error);
      return res.status(500).json({ message: "Failed to revoke session" });
    }

    return res.json({ message: "Session revoked successfully" });
  } catch (err) {
    console.error("[sessions] revoke crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/sessions/logout-others", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId;

    if (!currentSessionId) {
      return res.status(400).json({
        message: "Current session is not trackable. Please login again.",
      });
    }

    const { error } = await supabase
      .from("user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .neq("id", currentSessionId)
      .is("revoked_at", null);

    if (error) {
      console.error("[sessions] logout others error:", error);
      return res.status(500).json({ message: "Failed to logout other sessions" });
    }

    return res.json({ message: "Other sessions logged out successfully" });
  } catch (err) {
    console.error("[sessions] logout others crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;