const { scanUsdtDeposits } = require("../services/usdtDepositScanner.service");

let isRunning = false;

let lastUsdtScannerStatus = {
  enabled: false,
  intervalMs: Number(process.env.USDT_DEPOSIT_SCANNER_INTERVAL_MS || 120000),
  isRunning: false,
  lastScanAt: null,
  lastScannedAddresses: 0,
  lastDetectedDeposits: 0,
  lastCreditedDeposits: 0,
  lastErrors: 0,
};

function getUsdtScannerStatus() {
  return {
    ...lastUsdtScannerStatus,
    enabled:
      String(process.env.USDT_DEPOSIT_SCANNER_ENABLED || "false").toLowerCase() ===
      "true",
    intervalMs: Number(process.env.USDT_DEPOSIT_SCANNER_INTERVAL_MS || 120000),
    isRunning,
  };
}

function startUsdtDepositScannerJob() {
  const enabled = String(process.env.USDT_DEPOSIT_SCANNER_ENABLED || "false").toLowerCase();
  const intervalMs = Number(process.env.USDT_DEPOSIT_SCANNER_INTERVAL_MS || 120000);

  lastUsdtScannerStatus.enabled = enabled === "true";
  lastUsdtScannerStatus.intervalMs = intervalMs;

  if (enabled !== "true") {
    console.log("[usdt-deposit-scanner] automatic scanner disabled");
    return;
  }

  console.log(`[usdt-deposit-scanner] automatic scanner enabled. interval=${intervalMs}ms`);

  setInterval(async () => {
    if (isRunning) {
      console.log("[usdt-deposit-scanner] previous scan still running, skipping");
      return;
    }

    isRunning = true;

    try {
      const result = await scanUsdtDeposits();

      lastUsdtScannerStatus = {
        enabled: true,
        intervalMs,
        isRunning: false,
        lastScanAt: new Date().toISOString(),
        lastScannedAddresses: result.scannedAddresses || 0,
        lastDetectedDeposits: result.detectedDeposits || 0,
        lastCreditedDeposits: result.creditedDeposits || 0,
        lastErrors: result.errors?.length || 0,
      };

      console.log("[usdt-deposit-scanner] scan complete", {
        scannedAddresses: result.scannedAddresses,
        detectedDeposits: result.detectedDeposits,
        creditedDeposits: result.creditedDeposits,
        errors: result.errors?.length || 0,
      });
    } catch (err) {
      lastUsdtScannerStatus = {
        ...lastUsdtScannerStatus,
        isRunning: false,
        lastScanAt: new Date().toISOString(),
        lastErrors: (lastUsdtScannerStatus.lastErrors || 0) + 1,
      };

      console.error("[usdt-deposit-scanner] scan failed:", err);
    } finally {
      isRunning = false;
    }
  }, intervalMs);
}

module.exports = {
  startUsdtDepositScannerJob,
  getUsdtScannerStatus,
};