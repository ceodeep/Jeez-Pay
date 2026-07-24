require("dotenv").config();

const crypto = require("crypto");
const supabase = require("../src/config/supabase");
const { hashMerchantApiKey } = require("../src/middlewares/merchantAuth.middleware");

async function main() {
  const merchantName = process.argv[2];

  if (!merchantName) {
    console.error("Usage: node scripts/createMerchantApiKey.js \"NileLive\"");
    process.exit(1);
  }

  const webhookSecret = crypto.randomBytes(32).toString("hex");

  let { data: merchant, error: merchantLookupErr } = await supabase
    .from("merchants")
    .select("*")
    .eq("name", merchantName)
    .maybeSingle();

  if (merchantLookupErr) {
    throw merchantLookupErr;
  }

  if (!merchant) {
    const { data: inserted, error: insertErr } = await supabase
      .from("merchants")
      .insert({
        name: merchantName,
        status: "active",
        webhook_secret: webhookSecret,
      })
      .select("*")
      .single();

    if (insertErr) {
      throw insertErr;
    }

    merchant = inserted;
  }

  const apiKey = `jp_live_${crypto.randomBytes(32).toString("hex")}`;
  const keyPrefix = apiKey.slice(0, 16);
  const keyHash = hashMerchantApiKey(apiKey);

  const { error: keyErr } = await supabase
    .from("merchant_api_keys")
    .insert({
      merchant_id: merchant.id,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      status: "active",
    });

  if (keyErr) {
    throw keyErr;
  }

  console.log("");
  console.log("Merchant created/found:", merchant.name);
  console.log("Merchant ID:", merchant.id);
  console.log("");
  console.log("SAVE THIS API KEY NOW. It will not be shown again:");
  console.log(apiKey);
  console.log("");
  console.log("Webhook secret:");
  console.log(merchant.webhook_secret || webhookSecret);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
