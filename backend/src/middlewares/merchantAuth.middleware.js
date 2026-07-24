const crypto = require("crypto");
const supabase = require("../config/supabase");

function hashMerchantApiKey(apiKey) {
  const pepper = process.env.MERCHANT_API_KEY_PEPPER;

  if (!pepper) {
    throw new Error("MERCHANT_API_KEY_PEPPER is not configured");
  }

  return crypto
    .createHash("sha256")
    .update(`${apiKey}:${pepper}`)
    .digest("hex");
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function merchantAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing merchant API key" });
    }

    const apiKey = header.slice("Bearer ".length).trim();

    if (!apiKey.startsWith("jp_") || apiKey.length < 30) {
      return res.status(401).json({ message: "Invalid merchant API key" });
    }

    const keyPrefix = apiKey.slice(0, 16);
    const keyHash = hashMerchantApiKey(apiKey);

    const { data: keyRow, error: keyErr } = await supabase
      .from("merchant_api_keys")
      .select(`
        id,
        merchant_id,
        key_prefix,
        key_hash,
        status,
        merchants (
          id,
          name,
          status,
          webhook_url,
          webhook_secret
        )
      `)
      .eq("key_prefix", keyPrefix)
      .maybeSingle();

    if (keyErr) {
      console.error("[merchant-auth] key lookup error:", keyErr);
      return res.status(500).json({ message: "Merchant auth failed" });
    }

    if (
      !keyRow ||
      keyRow.status !== "active" ||
      !safeEqual(keyRow.key_hash, keyHash) ||
      !keyRow.merchants ||
      keyRow.merchants.status !== "active"
    ) {
      return res.status(401).json({ message: "Invalid merchant API key" });
    }

    req.merchant = keyRow.merchants;
    req.merchantApiKeyId = keyRow.id;

    supabase
      .from("merchant_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRow.id)
      .then(({ error }) => {
        if (error) {
          console.error("[merchant-auth] last_used update error:", error);
        }
      });

    return next();
  } catch (err) {
    console.error("[merchant-auth] crash:", err);
    return res.status(500).json({ message: "Merchant auth failed" });
  }
}

module.exports = {
  merchantAuthMiddleware,
  hashMerchantApiKey,
};
