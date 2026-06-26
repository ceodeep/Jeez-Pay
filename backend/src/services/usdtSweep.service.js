const supabase = require("../config/supabase");

const {
  decryptPrivateKey,
  sendUsdtTrc20FromPrivateKey,
  sendTrxFromPrivateKey,
} = require("./tron.service");
const { rentTronEnergy } = require("./tronmax.service");

const TREASURY_ADDRESS = process.env.TRON_TREASURY_ADDRESS;
const TREASURY_PRIVATE_KEY = process.env.TRON_TREASURY_PRIVATE_KEY;


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

  if (error) throw error;

  const results = [];

  for (const deposit of deposits || []) {
    try {
      const { data: lockedDeposit, error: lockErr } = await supabase
        .from("crypto_deposits")
        .update({ sweep_status: "sweeping", sweep_error: null })
        .eq("id", deposit.id)
        .eq("sweep_status", "not_swept")
        .select("id")
        .maybeSingle();

      if (lockErr) throw lockErr;

      if (!lockedDeposit) {
        results.push({
          depositId: deposit.id,
          status: "skipped",
          error: "Deposit already being processed",
        });
        continue;
      }

      const { data: depositAddress, error: addrErr } = await supabase
        .from("crypto_deposit_addresses")
        .select("address, encrypted_private_key, tron_activated")
        .eq("address", deposit.to_address)
        .in("network", ["TRON", "TRC20"])
        .eq("token", "USDT")
        .maybeSingle();

      if (addrErr) throw addrErr;

      if (!depositAddress?.encrypted_private_key) {
        throw new Error("Deposit private key not found");
      }

      const userPrivateKey = decryptPrivateKey(
        depositAddress.encrypted_private_key
      );

      let tronmaxOrder = null;

      if (!depositAddress.tron_activated) {
  const activationTxHash = await sendTrxFromPrivateKey({
    fromPrivateKey: TREASURY_PRIVATE_KEY,
    toAddress: deposit.to_address,
    amount: 1,
  });

  if (!activationTxHash) {
    throw new Error("TRON activation failed: no transaction hash returned");
  }

  await new Promise((resolve) => setTimeout(resolve, 10000));

  await supabase
    .from("crypto_deposit_addresses")
    .update({
      tron_activated: true,
      tron_activation_tx_hash: activationTxHash,
      tron_activated_at: new Date().toISOString(),
    })
    .eq("address", deposit.to_address);
}

      try {
        tronmaxOrder = await rentTronEnergy({
  receiver: deposit.to_address,
  amount: Number(
    process.env.TRONMAX_SWEEP_ENERGY ||
    process.env.TRONMAX_DEFAULT_ENERGY ||
    65000
  ),
  duration: process.env.TRONMAX_DEFAULT_DURATION || "15m",
  purpose: "trc20_sweep",
});
      } catch (rentErr) {
        throw new Error(`TronMax energy rental failed: ${rentErr.message}`);
      }

      

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
            tronmax_order: tronmaxOrder || null,
          },
        })
        .eq("id", deposit.id);

      results.push({
        depositId: deposit.id,
        status: "swept",
        tronmaxOrder,
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
        error: err.message || "Sweep failed",
      });
    }
  }

  return results;
}

module.exports = {
  sweepCreditedUsdtDeposits,
};