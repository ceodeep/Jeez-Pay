const express = require("express");
const router = express.Router();

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");
const authMiddleware = require("../middlewares/auth.middleware");
const bcrypt = require("bcrypt");

// You can keep your currencies here
const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];

function normalizePhone(raw) {
  const p = String(raw || "").trim();
  const digits = p.replace(/\D/g, "");

  if (!digits) return "";

  // If already international with +
  if (p.startsWith("+")) {
    return "+" + digits;
  }

  // Otherwise assume caller already selected a country code and sent full number
  return "+" + digits;
}

function mapAccountTypeToRole(accountType) {
  const value = String(accountType || "").trim().toLowerCase();

  if (value === "agent") return "agent";
  if (value === "merchant") return "merchant";
  return "user"; // Personal -> user
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

// =====================================
// SIGNUP OTP REQUEST
// OTP is used ONLY for phone verification during signup
// =====================================
router.post("/signup/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const accountType = String(req.body.accountType || "").trim();
    const countryCode = String(req.body.countryCode || "").trim();
    const termsAccepted = !!req.body.termsAccepted;

    if (!phone || !password || !accountType || !countryCode) {
      return res.status(400).json({
        message: "phone, password, accountType and countryCode are required",
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        message: "Password must be at least 4 characters",
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

    // Mock OTP generation/sending for now
    return res.json({
      message: "Enter the code sent to your phone",
    });
  } catch (err) {
    console.error("signup/request-otp crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// SIGNUP OTP VERIFY
// Creates the user ONLY after OTP is verified
// =====================================
router.post("/signup/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const otp = String(req.body.otp || "").trim();
    const password = String(req.body.password || "");
    const accountType = String(req.body.accountType || "").trim();
    const countryCode = String(req.body.countryCode || "").trim();
    const termsAccepted = !!req.body.termsAccepted;

    if (!phone || !otp || !password || !accountType || !countryCode) {
      return res.status(400).json({
        message: "phone, otp, password, accountType and countryCode are required",
      });
    }

    if (!termsAccepted) {
      return res.status(400).json({
        message: "Terms must be accepted",
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        message: "Password must be at least 4 characters",
      });
    }

    // Mock OTP check
    if (otp !== "123456") {
      return res.status(401).json({ message: "Invalid OTP" });
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
        .insert([{
          phone,
          password_hash: passwordHash,
          phone_verified: true,
          account_type: accountType,
          country_code: countryCode,
          terms_accepted: termsAccepted,
          role,
        }])
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
          password_hash: passwordHash,
          phone_verified: true,
          account_type: accountType,
          country_code: countryCode,
          terms_accepted: termsAccepted,
          role,
        })
        .eq("id", user.id)
        .select()
        .single();

      if (updateErr) {
        console.error("signup/verify-otp update error:", updateErr);
        return res.status(500).json({ message: "User update failed" });
      }

      user = updatedUser;

      // Seed wallets only if they do not already exist
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
// No OTP here
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
      .select("id, phone, password_hash, pin_hash, role, phone_verified")
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
        const lockUntil = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
        updates.pin_locked_until = lockUntil.toISOString();
        updates.pin_failed_attempts = 0;
      }

      await supabase
        .from("users")
        .update(updates)
        .eq("id", userId);

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
      .select("id, phone, role, account_type, country_code, phone_verified, terms_accepted")
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

module.exports = router;