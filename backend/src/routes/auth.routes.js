const express = require("express");
const router = express.Router();

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");
const authMiddleware = require("../middlewares/auth.middleware");

// You can keep your currencies here
const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];

function normalizePhoneSudan(raw) {
  const p = String(raw || "").trim();

  // keep digits only
  const digits = p.replace(/\D/g, "");

  // If user types local "0XXXXXXXXX" (9 digits after 0), convert to +249XXXXXXXXX
  // Adjust if your local format differs.
  if (digits.startsWith("0") && digits.length >= 10) {
    return "+249" + digits.substring(1);
  }

  // If they typed 249XXXXXXXXX
  if (digits.startsWith("249")) {
    return "+249" + digits.substring(3);
  }

  // If already includes country code with plus in original, keep it
  if (p.startsWith("+") && digits.length >= 8) {
    return "+" + digits;
  }

  // Fallback: if they typed just 9 digits (e.g. 9XXXXXXXX), assume Sudan
  if (digits.length === 9) {
    return "+249" + digits;
  }

  // Last resort
  return p;
}

// ---- POST /auth/request-otp ----
router.post("/request-otp", (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ message: "Phone required" });
  }

  // Mock OTP generation and sending
  return res.json({ message: "Enter the code sent to your phone" });
});

// ---- POST /auth/verify-otp ----
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ message: "phone and otp required" });
    }

    // Mock OTP check
    if (otp !== "123456") {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // ✅ Normalize phone ONCE and use it everywhere
    const phoneNorm = normalizePhoneSudan(phone);

    // 1) Find user by normalized phone
    const { data: existingUser, error: fetchErr } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phoneNorm)
      .maybeSingle();

    if (fetchErr) {
      console.error("User fetch error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    const isNewUser = !existingUser;

    let user = existingUser;

    // 2) Create user if not exists
    if (!user) {
      const { data: newUser, error: createErr } = await supabase
        .from("users")
        .insert([{ phone: phoneNorm }])
        .select()
        .single();

      if (createErr) {
        console.error("User create error:", createErr);
        return res.status(500).json({ message: "User creation failed" });
      }

      user = newUser;
    }

    // 3) Seed currency wallets ONLY for brand new users
    if (isNewUser) {
      const seedRows = DEFAULT_CURRENCIES.map((currency) => ({
        user_id: user.id,
        currency,
        balance: 0,
      }));

      const { error: seedErr } = await supabase.from("wallets").insert(seedRows);

      if (seedErr) {
        console.error("Wallet seeding error:", seedErr);
        return res.status(500).json({ message: "Wallet seeding failed" });
      }
    }

    // 4) Generate token
    const token = generateToken({
      userId: user.id,
      phone: phoneNorm,
    });

    return res.json({
      message: "Authenticated",
      token,
      isNewUser, // ✅ IMPORTANT
    });
  } catch (err) {
    console.error("verify-otp crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

const bcrypt = require("bcrypt");

router.post("/set-pin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { pin } = req.body;

    if (!pin || pin.length !== 4) {
      return res.status(400).json({ message: "PIN must be 4 digits" });
    }

    const pinHash = await bcrypt.hash(pin, 10);

    const { error } = await supabase
      .from("users")
      .update({ pin_hash: pinHash })
      .eq("id", userId);

    if (error) {
      console.error("Set PIN error:", error);
      return res.status(500).json({ message: "Failed to set PIN" });
    }

    return res.json({ message: "PIN set successfully" });

  } catch (err) {
    console.error("set-pin crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/verify-pin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({ message: "PIN required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("pin_hash")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(500).json({ message: "User lookup failed" });
    }

    if (!user.pin_hash) {
      return res.status(400).json({
        code: "PIN_NOT_SET",
        message: "PIN not set for this account"
      });
    }

    const match = await bcrypt.compare(pin, user.pin_hash);

    if (!match) {
      return res.json({ ok: false, message: "Wrong PIN" });
    }

    return res.json({ ok: true });

  } catch (err) {
    console.error("verify-pin crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ---- GET /auth/me (protected) ----
router.get("/me", authMiddleware, (req, res) => {
  return res.json({
    message: "Authenticated",
    user: req.user,
  });
});

module.exports = router;
