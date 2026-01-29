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

router.post("/verify-otp",(req, res) => {
    const {phone, otp } = req.body;
    if(otp !== "123456"){
        return res.status(401).json({message: "Invalid OTP"});
    }
    res.json({message:"OTP verifeid (mocked)"});
});

module.exports = router;