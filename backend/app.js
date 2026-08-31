require("dotenv").config();
const express = require("express");

const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./src/routes/auth.routes");
const walletRoutes = require("./src/routes/wallet.routes");
const authMiddleware = require("./src/middlewares/auth.middleware");
const { walletProductPolicy } = require("./src/middlewares/productPolicy.middleware");
const {
  merchantProductPolicy,
  serviceProductPolicy,
} = require("./src/middlewares/nonWalletProductPolicy.middleware");
const kycRoutes = require("./src/routes/kyc.routes");
const adminRoutes = require("./src/routes/admin.routes");
const servicesRoutes = require("./src/routes/services.routes");
const merchantRoutes = require("./src/routes/merchant.routes");
const accountLinkRoutes = require("./src/routes/accountLink.routes");
const merchantAccountLinkRoutes = require("./src/routes/merchantAccountLink.routes");
const productRoutes = require("./src/routes/product.routes");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

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

const corsOptions = {
  origin: [
    "https://admin.jeezpay.co",
    "https://www.admin.jeezpay.co",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));




app.use(express.json());

// Public product configuration. This is safe to expose because it contains
// launch availability and capability flags only; financial authorization is
// still enforced by authenticated routes.
app.use("/products", productRoutes);

app.use("/auth/signup/request-otp", otpLimiter);
app.use("/auth/forgot-password/request-otp", otpLimiter);
app.use("/auth/forgot-pin/request-otp", otpLimiter);
app.use("/auth/change-email/request-otp", otpLimiter);
app.use("/auth", authLimiter, authRoutes);

app.use("/kyc", kycRoutes);

// Secure external-account authorization.
// Keep this before the generic /wallet router.
app.use(
  "/wallet/account-links",
  authMiddleware,
  accountLinkRoutes,
);

// Product policy is evaluated after authentication and before legacy wallet
// route code so disabled currencies cannot reach money-moving handlers.
app.use("/wallet", authMiddleware, walletProductPolicy, walletRoutes);
app.use("/admin", adminRoutes);

// Service payments sit outside /wallet, so enforce the same launch product
// policy before their legacy route code executes.
app.use("/services", serviceProductPolicy, servicesRoutes);

// Merchant account-link endpoints are isolated from the existing
// merchant payment/payout router.
app.use(
  "/merchant/account-links",
  merchantAccountLinkRoutes,
);

// Merchant payment creation and payouts are also money-moving entry points and
// must honor the server-side launch capability configuration.
app.use("/merchant", merchantProductPolicy, merchantRoutes);

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