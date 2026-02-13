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
    const phoneNorm = normalizePhoneSudan(phone); // ✅

    // 1) Find user by phone
    const { data: existingUser, error: fetchErr } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phoneNorm) // ✅ (was phone)
      .maybeSingle();

    if (fetchErr) {
      console.error("User fetch error:", fetchErr);
      return res.status(500).json({ message: "User lookup failed" });
    }

    let user = existingUser;

    // 2) Create user if not exists
    if (!user) {
      const { data: newUser, error: createErr } = await supabase
        .from("users")
        .insert([{ phone: phoneNorm }]) // ✅ (was phone)
        .select()
        .single();

      if (createErr) {
        console.error("User create error:", createErr);
        return res.status(500).json({ message: "User creation failed" });
      }

      user = newUser;
    }

    // 3) Seed currency wallets
    // ✅ CRITICAL FIX:
    // Use "ignoreDuplicates: true" so it DOES NOT overwrite existing balances.
    // This prevents balances resetting to 0 on every login.

    // 3) Seed currency wallets ONLY for new users (so no balance reset)
if (!existingUser) {
  const seedRows = DEFAULT_CURRENCIES.map((currency) => ({
    user_id: user.id,
    currency,
    balance: 0,
  }));

  const { error: seedErr } = await supabase
    .from("wallets")
    .insert(seedRows);

  if (seedErr) {
    // If you already have unique(user_id,currency), duplicates will throw.
    // You can ignore duplicate error code if needed, but usually it won't happen for new users.
    console.error("Wallet seeding error:", seedErr);
    return res.status(500).json({ message: "Wallet seeding failed" });
  }
}

   

    // 4) Generate token
    const token = generateToken({
      userId: user.id,
      phone: phoneNorm,
    });

    return res.json({ message: "Authenticated", token });
  } catch (err) {
    console.error("verify-otp crash:", err);
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
