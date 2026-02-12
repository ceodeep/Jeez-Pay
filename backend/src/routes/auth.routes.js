const express = require("express");
const router = express.Router();

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");
const authMiddleware = require("../middlewares/auth.middleware");

// You can keep your currencies here
const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];

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

    // 1) Find user by phone
    const { data: existingUser, error: fetchErr } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone)
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
        .insert([{ phone }])
        .select()
        .single();

      if (createErr) {
        console.error("User create error:", createErr);
        return res.status(500).json({ message: "User creation failed" });
      }

      user = newUser;
    }

    // 3) Seed currency wallets (PRO way: one upsert)
    // NOTE: requires UNIQUE(user_id, currency) for best safety.
    const seedRows = DEFAULT_CURRENCIES.map((currency) => ({
      user_id: user.id,
      currency,
      balance: 0,
    }));

    const { error: seedErr } = await supabase
      .from("wallets")
      .upsert(seedRows, { onConflict: "user_id,currency" });

    if (seedErr) {
      console.error("Wallet seeding error:", seedErr);
      return res.status(500).json({ message: "Wallet seeding failed" });
    }

    // 4) Generate token
    const token = generateToken({
      userId: user.id,
      phone: user.phone,
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
