const supabase = require("../config/supabase");

const {
  decryptPrivateKey,
  sendUsdtTrc20FromPrivateKey,
  sendTrxFromPrivateKey,
} = require("./tron.service");

const TREASURY_ADDRESS = process.env.TRON_TREASURY_ADDRESS;
const TREASURY_PRIVATE_KEY = process.env.TRON_TREASURY_PRIVATE_KEY;

const SWEEP_TRX_TOPUP_AMOUNT = Number(process.env.SWEEP_TRX_TOPUP_AMOUNT || 30);
const MIN_SWEEP_AMOUNT = Number(process.env.MIN_USDT_SWEEP_AMOUNT || 1);

async function sweepCreditedUsdtDeposits(limit = 10) {
  if (!TREASURY_ADDRESS || !TREASURY_PRIVATE_KEY) {
    throw new Error("TRON treasury address/private key not configured");
  }

  const { data: deposits, error } = await supabase
    .from("crypto_deposits")
    .select("*")
    .in("network", ["TRON", "TRC20"])
    .eq("token", "USDT")
    .in("status", ["credited", "completed"])
    .eq("sweep_status", "not_swept")
    .gte("amount", MIN_SWEEP_AMOUNT)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  const results = [];

  for (const deposit of deposits || []) {
    try {
      await supabase
        .from("crypto_deposits")
        .update({ sweep_status: "funding", sweep_error: null })
        .eq("id", deposit.id)
        .eq("sweep_status", "not_swept");

      const { data: depositAddress, error: addrErr } = await supabase
        .from("crypto_deposit_addresses")
        .select("address, encrypted_private_key")
        .eq("address", deposit.to_address)
        .in("network", ["TRON", "TRC20"])
        .eq("token", "USDT")
        .maybeSingle();

      if (addrErr || !depositAddress?.encrypted_private_key) {
        throw new Error("Deposit private key not found");
      }

      const userPrivateKey = decryptPrivateKey(
        depositAddress.encrypted_private_key
      );

      const fundingTxHash = await sendTrxFromPrivateKey({
        fromPrivateKey: TREASURY_PRIVATE_KEY,
        toAddress: deposit.to_address,
        amount: SWEEP_TRX_TOPUP_AMOUNT,
      });

      await supabase
        .from("crypto_deposits")
        .update({ sweep_status: "sweeping" })
        .eq("id", deposit.id);

      const sweepTxHash = await sendUsdtTrc20FromPrivateKey({
        fromPrivateKey: userPrivateKey,
        toAddress: TREASURY_ADDRESS,
        amount: Number(deposit.amount),
      });

      await supabase
        .from("crypto_deposits")
        .update({
          sweep_status: "swept",
          sweep_tx_hash: sweepTxHash,
          swept_at: new Date().toISOString(),
          sweep_error: null,
          raw_payload: {
            ...(deposit.raw_payload || {}),
            sweep_funding_tx_hash: fundingTxHash,
          },
        })
        .eq("id", deposit.id);

      results.push({
        depositId: deposit.id,
        status: "swept",
        fundingTxHash,
        sweepTxHash,
      });
    } catch (err) {
      await supabase
        .from("crypto_deposits")
        .update({
          sweep_status: "failed",
          sweep_error: err.message || "Sweep failed",
        })
        .eq("id", deposit.id);

      results.push({
        depositId: deposit.id,
        status: "failed",
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = {
  sweepCreditedUsdtDeposits,
};