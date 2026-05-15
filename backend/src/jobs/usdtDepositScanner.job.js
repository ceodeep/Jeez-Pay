const { scanUsdtDeposits } = require("../services/usdtDepositScanner.service");

let isRunning = false;

function startUsdtDepositScannerJob() {
  const enabled = String(process.env.USDT_DEPOSIT_SCANNER_ENABLED || "false").toLowerCase();

  if (enabled !== "true") {
    console.log("[usdt-deposit-scanner] automatic scanner disabled");
    return;
  }

  const intervalMs = Number(process.env.USDT_DEPOSIT_SCANNER_INTERVAL_MS || 120000);

  console.log(`[usdt-deposit-scanner] automatic scanner enabled. interval=${intervalMs}ms`);

  setInterval(async () => {
    if (isRunning) {
      console.log("[usdt-deposit-scanner] previous scan still running, skipping");
      return;
    }

    isRunning = true;

    try {
      const result = await scanUsdtDeposits();

      console.log("[usdt-deposit-scanner] scan complete", {
        scannedAddresses: result.scannedAddresses,
        detectedDeposits: result.detectedDeposits,
        creditedDeposits: result.creditedDeposits,
        errors: result.errors?.length || 0,
      });
    } catch (err) {
      console.error("[usdt-deposit-scanner] scan failed:", err);
    } finally {
      isRunning = false;
    }
  }, intervalMs);
}

module.exports = {
  startUsdtDepositScannerJob,
};