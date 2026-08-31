const {
  CAPABILITIES,
  DEFAULT_COUNTRY_CODE,
  isCapabilityEnabled,
  isProductEnabled,
  normalizeCurrency,
} = require("../services/capability.service");

const DEFAULT_LAUNCH_CURRENCY = "SSP";

function countryForCurrency(currency) {
  return normalizeCurrency(currency) === "USDT"
    ? "GLOBAL"
    : DEFAULT_COUNTRY_CODE;
}

function setDefaultBodyCurrency(req) {
  if (!req.body || typeof req.body !== "object") return;
  if (!req.body.currency) req.body.currency = DEFAULT_LAUNCH_CURRENCY;
}

function policyError(res, {
  code,
  message,
  currency,
  capability = null,
}) {
  return res.status(403).json({
    code,
    message,
    countryCode: countryForCurrency(currency),
    currency: normalizeCurrency(currency),
    capability,
  });
}

async function requireEnabledProduct(res, currency) {
  const normalizedCurrency = normalizeCurrency(currency);
  const countryCode = countryForCurrency(normalizedCurrency);

  const enabled = await isProductEnabled({
    countryCode,
    currency: normalizedCurrency,
  });

  if (enabled) return true;

  policyError(res, {
    code: "PRODUCT_DISABLED",
    message: `${normalizedCurrency} is not enabled for this launch`,
    currency: normalizedCurrency,
  });

  return false;
}

async function requireCapability(res, currency, capability) {
  const normalizedCurrency = normalizeCurrency(currency);
  const countryCode = countryForCurrency(normalizedCurrency);

  const enabled = await isCapabilityEnabled({
    countryCode,
    currency: normalizedCurrency,
    capability,
  });

  if (enabled) return true;

  policyError(res, {
    code: "CAPABILITY_DISABLED",
    message: `${capability} is not enabled for ${normalizedCurrency}`,
    currency: normalizedCurrency,
    capability,
  });

  return false;
}

async function serviceProductPolicy(req, res, next) {
  try {
    const path = String(req.path || "").toLowerCase();

    if (req.method !== "POST" || path !== "/request") {
      return next();
    }

    setDefaultBodyCurrency(req);
    const currency = normalizeCurrency(req.body?.currency);

    const enabled = await requireEnabledProduct(res, currency);
    if (!enabled) return;

    return next();
  } catch (error) {
    console.error("[product-policy] service policy failed:", error);
    return res.status(503).json({
      code: "PRODUCT_POLICY_UNAVAILABLE",
      message: "Product policy could not be evaluated",
    });
  }
}

async function merchantProductPolicy(req, res, next) {
  try {
    const path = String(req.path || "").toLowerCase();

    if (req.method === "POST" && path === "/payments") {
      setDefaultBodyCurrency(req);
      const currency = normalizeCurrency(req.body?.currency);

      const allowed = await requireCapability(
        res,
        currency,
        CAPABILITIES.MERCHANT_PAYMENT
      );

      if (!allowed) return;
      return next();
    }

    if (req.method === "POST" && path === "/payouts") {
      setDefaultBodyCurrency(req);
      const currency = normalizeCurrency(req.body?.currency);

      const allowed = await requireCapability(
        res,
        currency,
        CAPABILITIES.P2P_TRANSFER
      );

      if (!allowed) return;
      return next();
    }

    return next();
  } catch (error) {
    console.error("[product-policy] merchant policy failed:", error);
    return res.status(503).json({
      code: "PRODUCT_POLICY_UNAVAILABLE",
      message: "Product policy could not be evaluated",
    });
  }
}

module.exports = {
  merchantProductPolicy,
  serviceProductPolicy,
};
