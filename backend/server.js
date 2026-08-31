const app = require("./app");
const PORT = process.env.PORT || 3000;
const { startUsdtDepositScannerJob } = require("./src/jobs/usdtDepositScanner.job");
const {
    CAPABILITIES,
    isCapabilityEnabled,
} = require("./src/services/capability.service");

async function startBackgroundJobs() {
    try {
        const usdtReceiveEnabled = await isCapabilityEnabled({
            countryCode: "GLOBAL",
            currency: "USDT",
            capability: CAPABILITIES.USDT_RECEIVE,
        });

        if (!usdtReceiveEnabled) {
            console.log(
                "[usdt-deposit-scanner] disabled by product capability policy"
            );
            return;
        }

        startUsdtDepositScannerJob();
    } catch (error) {
        // Fail closed. A capability lookup failure must never enable a disabled
        // custody/scanner path implicitly.
        console.error(
            "[usdt-deposit-scanner] capability check failed; scanner not started:",
            error
        );
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    void startBackgroundJobs();
});