const supabase = require("../config/supabase");

const DEFAULT_COUNTRY_CODE = "SS";

const COUNTRY_CODE_ALIASES = Object.freeze({
  SS: "SS",
  "+211": "SS",
  "211": "SS",
  SD: "SD",
  "+249": "SD",
  "249": "SD",
  UG: "UG",
  "+256": "UG",
  "256": "UG",
  EG: "EG",
  "+20": "EG",
  "20": "EG",
  GLOBAL: "GLOBAL",
});

const CAPABILITIES = Object.freeze({
  FIAT_HOLD: "FIAT_HOLD",
  P2P_TRANSFER: "P2P_TRANSFER",
  CASH_IN: "CASH_IN",
  CASH_OUT: "CASH_OUT",
  MERCHANT_PAYMENT: "MERCHANT_PAYMENT",
  SERVICE_PAYMENT: "SERVICE_PAYMENT",
  CROSS_BORDER_SEND: "CROSS_BORDER_SEND",
  CROSS_BORDER_RECEIVE: "CROSS_BORDER_RECEIVE",
  FX_CONVERT: "FX_CONVERT",
  USDT_HOLD: "USDT_HOLD",
  USDT_SEND: "USDT_SEND",
  USDT_RECEIVE: "USDT_RECEIVE",
  USDT_BUY: "USDT_BUY",
  USDT_SELL: "USDT_SELL",
});

function normalizeCountryCode(value) {
  const raw = String(value || DEFAULT_COUNTRY_CODE).trim().toUpperCase();
  const normalized = raw || DEFAULT_COUNTRY_CODE;

  return COUNTRY_CODE_ALIASES[normalized] || normalized;
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCapability(value) {
  return String(value || "").trim().toUpperCase();
}

async function getCountryProductConfiguration(countryCodeRaw) {
  const countryCode = normalizeCountryCode(countryCodeRaw);

  const { data: products, error: productsError } = await supabase
    .from("country_products")
    .select("country_code,currency,display_name,enabled,is_default,sort_order")
    .eq("country_code", countryCode)
    .order("sort_order", { ascending: true });

  if (productsError) throw productsError;

  const enabledProducts = (products || []).filter(
    (product) => product.enabled === true
  );

  if (enabledProducts.length === 0) {
    return {
      countryCode,
      defaultCurrency: null,
      products: [],
    };
  }

  const currencies = enabledProducts.map((product) => product.currency);

  const { data: capabilityRows, error: capabilitiesError } = await supabase
    .from("product_capabilities")
    .select("country_code,currency,capability,enabled")
    .eq("country_code", countryCode)
    .in("currency", currencies);

  if (capabilitiesError) throw capabilitiesError;

  const capabilitiesByCurrency = new Map();

  for (const row of capabilityRows || []) {
    if (!capabilitiesByCurrency.has(row.currency)) {
      capabilitiesByCurrency.set(row.currency, {});
    }

    capabilitiesByCurrency.get(row.currency)[row.capability] =
      row.enabled === true;
  }

  const defaultProduct =
    enabledProducts.find((product) => product.is_default === true) ||
    enabledProducts[0];

  return {
    countryCode,
    defaultCurrency: defaultProduct?.currency || null,
    products: enabledProducts.map((product) => ({
      currency: product.currency,
      displayName: product.display_name,
      isDefault: product.is_default === true,
      capabilities: capabilitiesByCurrency.get(product.currency) || {},
    })),
  };
}

async function isProductEnabled({ countryCode, currency }) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const normalizedCurrency = normalizeCurrency(currency);

  if (!normalizedCurrency) return false;

  const { data, error } = await supabase
    .from("country_products")
    .select("enabled")
    .eq("country_code", normalizedCountryCode)
    .eq("currency", normalizedCurrency)
    .maybeSingle();

  if (error) throw error;
  return data?.enabled === true;
}

async function isCapabilityEnabled({ countryCode, currency, capability }) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedCapability = normalizeCapability(capability);

  if (!normalizedCurrency || !normalizedCapability) return false;

  const productEnabled = await isProductEnabled({
    countryCode: normalizedCountryCode,
    currency: normalizedCurrency,
  });

  if (!productEnabled) return false;

  const { data, error } = await supabase
    .from("product_capabilities")
    .select("enabled")
    .eq("country_code", normalizedCountryCode)
    .eq("currency", normalizedCurrency)
    .eq("capability", normalizedCapability)
    .maybeSingle();

  if (error) throw error;
  return data?.enabled === true;
}

module.exports = {
  CAPABILITIES,
  COUNTRY_CODE_ALIASES,
  DEFAULT_COUNTRY_CODE,
  normalizeCountryCode,
  normalizeCurrency,
  getCountryProductConfiguration,
  isProductEnabled,
  isCapabilityEnabled,
};
