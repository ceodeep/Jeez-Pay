const supabase = require("../config/supabase");

const USDT_DECIMALS = 6;



function normalizeTronAmount(value, decimals = USDT_DECIMALS) {
  const raw = Number(value || 0);
  const d = Number(decimals || USDT_DECIMALS);

  if (!Number.isFinite(raw) || raw <= 0) return 0;

  return raw / Math.pow(10, d);
}

function roundUsdt(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function calculateTrc20DepositFee({ amount, tronActivated }) {
  const trxUsdtRate = Number(process.env.TRX_USDT_ESTIMATE || 0.32);

  const activationBurnTrx = tronActivated
    ? 0
    : Number(process.env.TRC20_ACTIVATION_BURN_TRX || 1.1);

  const sweepRentalTrx = Number(process.env.TRC20_SWEEP_RENTAL_TRX || 4.225);
  const platformFeeUsdt = Number(process.env.TRC20_PLATFORM_FEE_USDT || 0.25);

  const networkFeeUsdt = roundUsdt(
    (activationBurnTrx + sweepRentalTrx) * trxUsdtRate
  );

  const totalFeeUsdt = roundUsdt(networkFeeUsdt + platformFeeUsdt);
  const netAmount = roundUsdt(Number(amount) - totalFeeUsdt);

  return {
    fee_model: "trc20_dynamic_estimate_v1",
    gross_amount: roundUsdt(amount),
    network_fee_usdt: networkFeeUsdt,
    platform_fee_usdt: roundUsdt(platformFeeUsdt),
    total_fee_usdt: totalFeeUsdt,
    net_amount: netAmount,
    fee_currency: "USDT",
    estimates: {
      trx_usdt_rate: trxUsdtRate,
      activation_burn_trx: activationBurnTrx,
      sweep_rental_trx: sweepRentalTrx,
      tron_activated: !!tronActivated,
    },
  };
}

async function ensureWallet(userId, currency) {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();

  const { data: wallet, error } = await supabase
    .from("wallets")
    .select("id, balance, currency")
    .eq("user_id", userId)
    .eq("currency", normalizedCurrency)
    .maybeSingle();

  if (error) return { wallet: null, error };
  if (wallet) return { wallet, error: null };

  const { data: created, error: createErr } = await supabase
    .from("wallets")
    .insert({
      user_id: userId,
      currency: normalizedCurrency,
      balance: 0,
    })
    .select("id, balance, currency")
    .single();

  if (createErr) return { wallet: null, error: createErr };
  return { wallet: created, error: null };
}

async function fetchTrc20TransfersForAddress(address) {
  const fullHost = process.env.TRON_FULL_HOST || "https://api.trongrid.io";
  const contract = process.env.USDT_TRC20_CONTRACT;

  if (!contract) {
    throw new Error("USDT_TRC20_CONTRACT is missing");
  }

  const url =
  `${fullHost}/v1/accounts/${address}/transactions/trc20` +
  `?limit=50&only_confirmed=true&only_to=true&contract_address=${contract}&order_by=block_timestamp,desc`;

  const headers = {};
  if (process.env.TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TronGrid failed: ${response.status} ${body}`);
  }

  const json = await response.json();
  return (json.data || [])
  .filter((tx) => String(tx.to || "").toLowerCase() === String(address).toLowerCase())
  .filter((tx) => String(tx.token_info?.address || "").toLowerCase() === String(contract).toLowerCase())
  .sort((a, b) => Number(b.block_timestamp || 0) - Number(a.block_timestamp || 0));
}

async function creditDepositOnce({ addressRow, transfer }) {
  const txHash = transfer.transaction_id || transfer.txID || transfer.hash;
  const toAddress = transfer.to;
  const fromAddress = transfer.from;

  if (!txHash || !toAddress) {
    return { credited: false, reason: "missing_tx_hash_or_to_address" };
  }

  if (String(toAddress).toLowerCase() !== String(addressRow.address).toLowerCase()) {
    return { credited: false, reason: "not_target_address", txHash };
  }

  const decimals = transfer.token_info?.decimals || USDT_DECIMALS;
  const amount = normalizeTronAmount(transfer.value, decimals);

  if (!amount || amount <= 0) {
    return { credited: false, reason: "invalid_amount", txHash };
  }

  const fee = calculateTrc20DepositFee({
  amount,
  tronActivated: addressRow.tron_activated,
});

if (fee.net_amount <= 0) {
  return {
    credited: false,
    reason: "deposit_amount_too_small_after_fee",
    txHash,
    amount,
    fee,
  };
}

const { data, error } = await supabase.rpc("credit_usdt_trc20_deposit", {
  p_user_id: addressRow.user_id,
  p_tx_hash: txHash,
  p_from_address: fromAddress || null,
  p_to_address: toAddress,
  p_amount: amount,
  p_raw_payload: {
    ...transfer,
    jeezpay_fee: fee,
  },
});

  if (error) {
    throw error;
  }

  return data || {
    credited: false,
    reason: "empty_rpc_response",
    txHash,
  };
}

async function scanUsdtDeposits() {
  const startedAt = new Date().toISOString();

  const { data: addresses, error: addressErr } = await supabase
    .from("crypto_deposit_addresses")
    .select("user_id, address, network, token, tron_activated")
    .in("network", ["TRON", "TRC20"])
    .eq("token", "USDT")
    .eq("is_active", true);

  if (addressErr) throw addressErr;

  let scannedAddresses = 0;
  let detectedDeposits = 0;
  let creditedDeposits = 0;

  const credited = [];
  const skipped = [];
  const errors = [];

  for (const addressRow of addresses || []) {
    scannedAddresses += 1;

    try {
      const transfers = await fetchTrc20TransfersForAddress(addressRow.address);

      for (const transfer of transfers) {
        detectedDeposits += 1;

        try {
          const result = await creditDepositOnce({ addressRow, transfer });

          if (result.credited) {
            creditedDeposits += 1;
            credited.push(result);
          } else {
            skipped.push(result);
          }
        } catch (err) {
          console.error("[usdt-deposit-scanner] credit error:", err);
          errors.push({
            address: addressRow.address,
            txHash: transfer.transaction_id || transfer.txID || transfer.hash || null,
            message: err.message || "Credit failed",
          });
        }
      }
    } catch (err) {
      console.error("[usdt-deposit-scanner] address scan error:", addressRow.address, err);
      errors.push({
        address: addressRow.address,
        message: err.message || "Address scan failed",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  return {
    message: "Deposit scan completed",
    startedAt,
    finishedAt: new Date().toISOString(),
    scannedAddresses,
    detectedDeposits,
    creditedDeposits,
    credited,
    skippedCount: skipped.length,
    errors,
  };
}

module.exports = {
  scanUsdtDeposits,
};