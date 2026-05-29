require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./src/routes/auth.routes");
const walletRoutes = require("./src/routes/wallet.routes");
const authMiddleware = require("./src/middlewares/auth.middleware");
const kycRoutes = require("./src/routes/kyc.routes");
const adminRoutes = require("./src/routes/admin.routes");
const servicesRoutes = require("./src/routes/services.routes");

const app = express();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { message: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { message: "Too many OTP requests. Please wait and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(morgan("dev"));
app.use(cors());
app.use(express.json());

app.use("/auth/signup/request-otp", otpLimiter);
app.use("/auth/forgot-password/request-otp", otpLimiter);
app.use("/auth/forgot-pin/request-otp", otpLimiter);
app.use("/auth", authLimiter, authRoutes);

app.use("/kyc", kycRoutes);
app.use("/wallet", authMiddleware, walletRoutes);
app.use("/admin", adminRoutes);
app.use("/services", servicesRoutes);

app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "JeezPay API" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = app;