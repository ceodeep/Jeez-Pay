const rateLimit = require("express-rate-limit");

const transferLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many transfer attempts. Please try again later." },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP attempts. Please try again later." },
});

const pinVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many PIN verification attempts. Please try again later." },
});


const adminMfaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many MFA attempts. Please wait and try again.",
  },
});

module.exports = {
  transferLimiter,
  otpVerifyLimiter,
  pinVerifyLimiter,
  adminMfaLimiter,
};