require("dotenv").config();

const {
  processPendingMerchantWebhooks,
} = require("../src/services/merchantWebhook.service");

async function main() {
  const limit = Number(process.argv[2] || 10);

  const results = await processPendingMerchantWebhooks(limit);

  console.log(JSON.stringify({
    ok: true,
    processed: results.length,
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
