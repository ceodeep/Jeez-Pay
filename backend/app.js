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
const kycV3Routes = require("./src/routes/kycV3.routes");
const kycLifecycleV2Routes = require("./src/routes/kycLifecycleV2.routes");
const kycRoutes = require("./src/routes/kyc.routes");
const adminKycV3Routes = require("./src/routes/adminKycV3.routes");
const adminSanctionsV1Routes = require("./src/routes/adminSanctionsV1.routes");
const adminAgentsV1Routes = require("./src/routes/adminAgentsV1.routes");
const adminKycV2Routes = require("./src/routes/adminKycV2.routes");
const adminComplianceV1Routes = require("./src/routes/adminComplianceV1.routes");
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

// API-only security headers. HSTS is emitted only when the request arrived over
// HTTPS at the trusted reverse proxy so local HTTP development is not pinned.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );

  if (req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  next();
});

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

// Never log query strings, authorization headers, request bodies, referrers or
// user agents. This keeps operational logs useful without leaking common PII or
// secrets carried in URLs/headers.
morgan.token("safe-url", (req) => {
  const url = req.originalUrl || req.url || "/";
  return url.split("?", 1)[0];
});
app.use(
  morgan(":method :safe-url :status :res[content-length] - :response-time ms")
);

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

// KYC evidence uses signed object-storage uploads; API JSON payloads should
// remain small. Bounding parser input limits memory/CPU abuse at the edge.
app.use(express.json({ limit: "1mb" }));

app.use("/products", productRoutes);

app.use("/auth/signup/request-otp", otpLimiter);
app.use("/auth/forgot-password/request-otp", otpLimiter);
app.use("/auth/forgot-pin/request-otp", otpLimiter);
app.use("/auth/change-email/request-otp", otpLimiter);
app.use("/auth", authLimiter, authRoutes);

// KYC v3 is the authoritative international customer contract. Hardened V2
// remains only as backward compatibility for old clients/routes that V3 does
// not intercept. V3 /me never exposes private storage object paths.
app.use(
  "/kyc",
  kycV3Routes,
  kycLifecycleV2Routes,
  kycRoutes,
);

app.use(
  "/wallet/account-links",
  authMiddleware,
  accountLinkRoutes,
);

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

// KYC v3 reviewer APIs use deterministic keyset pagination, atomic claiming,
// fresh public sanctions screening, signed evidence only on detail view,
// controlled checks and senior approval. Existing V2 admin routes remain as
// fallback for legacy records. Agent desks are managed through a dedicated
// lifecycle API; generic role editing does not create operational agents.
app.use(
  "/admin",
  adminProductPolicy,
  adminSanctionsV1Routes,
  adminAgentsV1Routes,
  adminKycV3Routes,
  adminKycV2Routes,
  adminComplianceV1Routes,
  adminLaunchMoneyV2Routes,
  adminRoutes,
);

app.use("/services", serviceProductPolicy, servicesRoutes);

app.use(
  "/merchant/account-links",
  merchantAccountLinkRoutes,
);

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
