const supabase = require("../config/supabase");
const { decryptPrivateKey } = require("./tron.service");
const {
  sendBnbFromPrivateKey,
  sendUsdtBep20FromPrivateKey,
  getBnbBalance,
} = require("./bsc.service");

const TREASURY_ADDRESS = process.env.BSC_TREASURY_ADDRESS;
const TREASURY_PRIVATE_KEY = process.env.BSC_TREASURY_PRIVATE_KEY;

const BNB_TARGET_BALANCE = Number(
  process.env.BEP20_SWEEP_BNB_TARGET_BALANCE ||
  process.env.BEP20_SWEEP_BNB_TOPUP_AMOUNT ||
  0.001
);
const MIN_SWEEP_AMOUNT = Number(process.env.MIN_BEP20_SWEEP_AMOUNT || 1);

async function sweepCreditedBep20Deposits(limit = 10) {
  if (!TREASURY_ADDRESS || !TREASURY_PRIVATE_KEY) {
    throw new Error("BSC treasury address/private key not configured");
  }

  const { data: deposits, error } = await supabase
    .from("crypto_deposits")
    .select("*")
    .eq("network", "BEP20")
    .eq("token", "USDT")
    .eq("status", "completed")
    .eq("sweep_status", "not_swept")
    .gte("amount", MIN_SWEEP_AMOUNT)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

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
        .eq("network", "BEP20")
        .eq("token", "USDT")
        .maybeSingle();

      if (addrErr || !depositAddress?.encrypted_private_key) {
        throw new Error("BEP20 deposit private key not found");
      }

      const userPrivateKey = decryptPrivateKey(depositAddress.encrypted_private_key);

      const bnbBalanceBefore = await getBnbBalance(deposit.to_address);

let fundingTxHash = null;
let bnbTopupAmount = 0;

if (bnbBalanceBefore < BNB_TARGET_BALANCE) {
  bnbTopupAmount =
    Math.ceil((BNB_TARGET_BALANCE - bnbBalanceBefore) * 100_000_000) /
    100_000_000;

  fundingTxHash = await sendBnbFromPrivateKey({
    fromPrivateKey: TREASURY_PRIVATE_KEY,
    toAddress: deposit.to_address,
    amount: bnbTopupAmount,
  });
}

      await supabase
        .from("crypto_deposits")
        .update({ sweep_status: "sweeping" })
        .eq("id", deposit.id);

      const sweepTxHash = await sendUsdtBep20FromPrivateKey({
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
  bep20_sweep: {
    funding_tx_hash: fundingTxHash,
    bnb_balance_before: bnbBalanceBefore,
    bnb_target_balance: BNB_TARGET_BALANCE,
    bnb_topup_amount: bnbTopupAmount,
  },
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
          sweep_error: err.message || "BEP20 sweep failed",
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
  sweepCreditedBep20Deposits,
};