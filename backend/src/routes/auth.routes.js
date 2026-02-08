const express = require('express');
const router = express.Router();

router.post("/request-otp", (req, res) => {
    const{phone} = req.body;
    if (!phone){
        return res.status(400).json({ message: "Phone required" });
    }

    // Mock OTP generation and sending
    res.json({ message: "OTP sent (mocked)"});
});

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");

router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ message: "phone and otp required" });
    }

    if (otp !== "123456") {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // 1) Try fetch user (handle not-found safely)
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

    // 3) Ensure wallet exists
    const { data: wallet, error: walletFetchError } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (walletFetchError) {
      console.error("Wallet fetch error:", walletFetchError);
      return res.status(500).json({ message: "Wallet check failed" });
    }

    if (!wallet) {
      const { error: walletCreateError } = await supabase
        .from("wallets")
        .insert([{ user_id: user.id, balance: 0 }]);

      if (walletCreateError) {
        console.error("Wallet creation error:", walletCreateError);
        return res.status(500).json({ message: "Wallet creation failed" });
      }
    }

    // 4) Generate token and return
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

module.exports = router;