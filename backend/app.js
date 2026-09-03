require("dotenv").config();
const express = require("express");

const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./src/routes/auth.routes");
const walletRoutes = require("./src/routes/wallet.routes");
const walletTransferV2Routes = require("./src/routes/walletTransferV2.routes");
const walletMerchantV2Routes = require("./src/routes/walletMerchantV2.routes");
const walletAgentV2Routes = require("./src/routes/walletAgentV2.routes");
const walletAdminCreditV2Routes = require("./src/routes/walletAdminCreditV2.routes");
const authMiddleware = require("./src/middlewares/auth.middleware");
const { walletProductPolicy } = require("./src/middlewares/productPolicy.middleware");
const {
  adminProductPolicy,
  merchantProductPolicy,
  serviceProductPolicy,
} = require("./src/middlewares/nonWalletProductPolicy.middleware");
const kycLifecycleV2Routes = require("./src/routes/kycLifecycleV2.routes");
const kycRoutes = require("./src/routes/kyc.routes");
const adminKycV2Routes = require("./src/routes/adminKycV2.routes");
const adminRoutes = require("./src/routes/admin.routes");
const adminLaunchMoneyV2Routes = require("./src/routes/adminLaunchMoneyV2.routes");
const servicesRoutes = require("./src/routes/services.routes");
const merchantRoutes = require("./src/routes/merchant.routes");
const merchantMoneyV2Routes = require("./src/routes/merchantMoneyV2.routes");
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
  allowedHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key"],
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

// Phase 5.1 intercepts KYC submissions with the controlled lifecycle RPC.
// Existing read/upload endpoints continue through the legacy KYC router.
app.use("/kyc", kycLifecycleV2Routes, kycRoutes);

// Secure external-account authorization.
// Keep this before the generic /wallet router.
app.use(
  "/wallet/account-links",
  authMiddleware,
  accountLinkRoutes,
);

// Product policy is evaluated after authentication and before wallet route
// code. Phase 4 transition routers intercept only the money flows already
// proven against Ledger v2; all remaining wallet routes fall through unchanged.
app.use(
  "/wallet",
  authMiddleware,
  walletProductPolicy,
  walletAdminCreditV2Routes,
  walletTransferV2Routes,
  walletMerchantV2Routes,
  walletAgentV2Routes,
  walletRoutes,
);

// Admin reporting stays available, but manual balance/crypto configuration and
// money actions must obey the same launch product policy as customer routes.
// Phase 5.1 KYC review routes intercept approve/reject before legacy handlers.
// Native launch-money routes intercept reachable SSP writers after that.
app.use(
  "/admin",
  adminProductPolicy,
  adminKycV2Routes,
  adminLaunchMoneyV2Routes,
  adminRoutes,
);

// Service payments sit outside /wallet, so enforce the same launch product
// policy before their legacy route code executes.
app.use("/services", serviceProductPolicy, servicesRoutes);

// Merchant account-link endpoints are isolated from the existing
// merchant payment/payout router.
app.use(
  "/merchant/account-links",
  merchantAccountLinkRoutes,
);

// Phase 4.3C intercepts merchant payouts with the native Ledger v2 wrapper;
// other merchant endpoints continue through the existing router unchanged.
app.use(
  "/merchant",
  merchantProductPolicy,
  merchantMoneyV2Routes,
  merchantRoutes,
);

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
