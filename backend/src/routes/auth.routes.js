const express = require('express');
const router = express.Router();

router.post("/request-otp", (req, res) => {
    const{phone} = req.body;
    if (!phone){
        return res.status(400).json({ message: "Phone required" });
    }

    // Mock OTP generation and sending
    res.json({ message: "OTP sent (mocked)",
               otp: "123456", });
});

const supabase = require("../config/supabase");
const { generateToken } = require("../services/jwt.service");

router.post("/verify-otp", async (req, res) => {
    const { phone, otp } = req.body;
    if(otp !== "123456"){
        return res.status(401).json({message: "Invalid OTP"});
    }
    // Check if user exists
    const {data:existingUser } = await supabase
        .from("users")
        .select("*")
        .eq("phone", phone)
        .single();
        let user = existingUser;

    // Create user if not exists
    if(!existingUser){
        const {data: newUser} = await supabase
            .from("users")
            .insert([{phone}])
            .single();
        user = newUser;
    }
    const token = generateToken({
        userId: user.id,
        phone: user.phone
    });
    res.json({message:"Authenticated", token});

    // ---------- AUTO-CREATE WALLET IF NOT EXISTS ----------
    const { data: wallet, error: walletFetchError } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

        if (walletFetchError) {
            console.error("wallet fetch error:", walletFetchError);
            return res.status(500).json({message: "Wallet check failed"});
        }
        if (!wallet) {
            const {error: walletCreateError } = await supabase
                .from("wallets")
                .insert([{ user_id: user.id, balance: 0 }]);
                if (walletCreateError) {
                    console.error("wallet creation error:", walletCreateError);
                    return res.status(500).json({ message: "Wallet creation failed" });
                }
        }
        //-----------------------------------------------------------------//
});
module.exports = router;