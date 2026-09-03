const supabase = require("../config/supabase");
const {
  CAPABILITIES,
  DEFAULT_COUNTRY_CODE,
  getCountryProductConfiguration,
  isCapabilityEnabled,
  normalizeCurrency,
} = require("../services/capability.service");

function policyError(res, {
  status = 403,
  code,
  message,
  countryCode = DEFAULT_COUNTRY_CODE,
  currency = null,
  capability = null,
}) {
  return res.status(status).json({
    code,
    message,
    countryCode,
    currency,
    capability,
  });
}

function countryForCurrency(currency) {
  return normalizeCurrency(currency) === "USDT"
    ? "GLOBAL"
    : DEFAULT_COUNTRY_CODE;
}

async function ensureLaunchWallet(userId, currency) {
  const normalizedCurrency = normalizeCurrency(currency);

  const { error } = await supabase
    .from("wallets")
    .upsert(
      [{
        user_id: userId,
        currency: normalizedCurrency,
        balance: 0,
      }],
      {
        onConflict: "user_id,currency",
        ignoreDuplicates: true,
      }
    );

  if (error) throw error;
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
    countryCode,
    currency: normalizedCurrency,
    capability,
  });

  return false;
}

async function rejectDisabledCurrency(res, currency) {
  const normalizedCurrency = normalizeCurrency(currency);
  if (!normalizedCurrency) return false;

  const countryCode = countryForCurrency(normalizedCurrency);
  const configuration = await getCountryProductConfiguration(countryCode);
  const enabled = configuration.products.some(
    (product) => product.currency === normalizedCurrency
  );

  if (enabled) return false;

  policyError(res, {
    code: "PRODUCT_DISABLED",
    message: `${normalizedCurrency} is not enabled for this launch`,
    countryCode,
    currency: normalizedCurrency,
  });

  return true;
}

async function getMerchantPaymentCurrency(paymentId) {
  const normalizedPaymentId = String(paymentId || "").trim();
  if (!normalizedPaymentId) return null;

  const { data, error } = await supabase
    .from("merchant_payments")
    .select("currency")
    .eq("id", normalizedPaymentId)
    .maybeSingle();

  if (error) throw error;
  return normalizeCurrency(data?.currency);
}

function addDefaultQueryCurrency(req, currency) {
  if (req.query?.currency) return;

  const separator = req.url.includes("?") ? "&" : "?";
  req.url = `${req.url}${separator}currency=${encodeURIComponent(currency)}`;
}

function defaultBodyCurrency(req, currency) {
  if (!req.body || typeof req.body !== "object") return;
  if (!req.body.currency) req.body.currency = currency;
}

function collectRequestCurrencies(req) {
  const values = [
    req.query?.currency,
    req.body?.currency,
    req.body?.fromCurrency,
    req.body?.toCurrency,
  ];

  return [...new Set(values.map(normalizeCurrency).filter(Boolean))];
}

async function walletProductPolicy(req, res, next) {
  try {
    const configuration = await getCountryProductConfiguration(
      DEFAULT_COUNTRY_CODE
    );
    const defaultCurrency = normalizeCurrency(configuration.defaultCurrency);

    if (!defaultCurrency) {
      return policyError(res, {
        status: 503,
        code: "PRODUCT_CONFIGURATION_UNAVAILABLE",
        message: "No launch currency is currently enabled",
      });
    }

    const path = String(req.path || "").toLowerCase();

    // Existing accounts may already contain historical/disabled wallets. Keep
    // those rows intact, but expose only enabled launch products to clients.
    if (req.method === "GET" && path === "/balance") {
      await ensureLaunchWallet(req.user.userId, defaultCurrency);

      const sendJson = res.json.bind(res);
      res.json = (payload) => {
        if (!payload || !Array.isArray(payload.balances)) {
          return sendJson(payload);
        }

        const enabledCurrencies = new Set(
          configuration.products.map((product) => product.currency)
        );

        return sendJson({
          ...payload,
          balances: payload.balances.filter((balance) =>
            enabledCurrencies.has(normalizeCurrency(balance.currency))
          ),
        });
      };

      return next();
    }

    if (req.method === "GET" && path === "/history") {
      addDefaultQueryCurrency(req, defaultCurrency);
    }

    // Merchant payment confirmation only carries a PIN in the request body, so
    // the currency must be resolved from the stored payment before the legacy
    // confirmation route/RPC is allowed to run.
    const merchantPaymentConfirmMatch = path.match(
      /^\/merchant-payments\/([^/]+)\/confirm$/
    );

    if (req.method === "POST" && merchantPaymentConfirmMatch) {
      const paymentCurrency = await getMerchantPaymentCurrency(
        merchantPaymentConfirmMatch[1]
      );

      if (!paymentCurrency) {
        return policyError(res, {
          status: 404,
          code: "PAYMENT_NOT_FOUND",
          message: "Payment not found",
        });
      }

      if (await rejectDisabledCurrency(res, paymentCurrency)) return;

      const allowed = await requireCapability(
        res,
        paymentCurrency,
        CAPABILITIES.MERCHANT_PAYMENT
      );
      if (!allowed) return;

      return next();
    }

    // Crypto is a separate GLOBAL product. It remains in the architecture but
    // is hard-disabled for the SSP-only launch.
    if (path.startsWith("/crypto/")) {
      const capability = path.includes("withdraw")
        ? CAPABILITIES.USDT_SEND
        : CAPABILITIES.USDT_RECEIVE;

      const allowed = await requireCapability(res, "USDT", capability);
      if (!allowed) return;
      return next();
    }

    // FX is disabled at launch even if callers submit syntactically valid
    // currency pairs.
    if (path.startsWith("/swap/")) {
      const allowed = await requireCapability(
        res,
        req.body?.fromCurrency || defaultCurrency,
        CAPABILITIES.FX_CONVERT
      );
      if (!allowed) return;
      return next();
    }

    if (path === "/transfer" || path === "/transfer-quote") {
      defaultBodyCurrency(req, defaultCurrency);

      const currency = normalizeCurrency(req.body?.currency);
      if (await rejectDisabledCurrency(res, currency)) return;

      const allowed = await requireCapability(
        res,
        currency,
        CAPABILITIES.P2P_TRANSFER
      );
      if (!allowed) return;
    }

    if (path.includes("cash-in") || path.includes("deposit")) {
      defaultBodyCurrency(req, defaultCurrency);
      const currency = normalizeCurrency(
        req.body?.currency || req.query?.currency || defaultCurrency
      );

      if (await rejectDisabledCurrency(res, currency)) return;

      const allowed = await requireCapability(
        res,
        currency,
        CAPABILITIES.CASH_IN
      );
      if (!allowed) return;
    }

    if (path.includes("cash-out") || path.includes("withdraw")) {
      defaultBodyCurrency(req, defaultCurrency);
      const currency = normalizeCurrency(
        req.body?.currency || req.query?.currency || defaultCurrency
      );

      if (await rejectDisabledCurrency(res, currency)) return;

      const allowed = await requireCapability(
        res,
        currency,
        CAPABILITIES.CASH_OUT
      );
      if (!allowed) return;
    }

    // Defense in depth for legacy wallet endpoints not explicitly classified
    // above. Any supplied currency must still be an enabled launch product.
    for (const currency of collectRequestCurrencies(req)) {
      if (await rejectDisabledCurrency(res, currency)) return;
    }

    return next();
  } catch (error) {
    console.error("[product-policy] wallet policy failed:", error);
    return res.status(503).json({
      code: "PRODUCT_POLICY_UNAVAILABLE",
      message: "Product policy could not be evaluated",
    });
  }
}

module.exports = {
  walletProductPolicy,
};
