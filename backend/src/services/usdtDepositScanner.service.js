const supabase = require("../config/supabase");

const USDT_DECIMALS = 6;

function normalizeTronAmount(value, decimals = USDT_DECIMALS) {
  const raw = Number(value || 0);
  const d = Number(decimals || USDT_DECIMALS);

  if (!Number.isFinite(raw) || raw <= 0) return 0;

  return raw / Math.pow(10, d);
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
    `?limit=50&only_confirmed=true&only_to=true&contract_address=${contract}`;

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
  return json.data || [];
}

async function creditDepositOnce({ addressRow, transfer }) {
  const txHash = transfer.transaction_id || transfer.txID || transfer.hash;
  const toAddress = transfer.to;
  const fromAddress = transfer.from;

  if (!txHash || !toAddress) {
    return { credited: false, reason: "missing_tx_hash_or_to_address" };
  }

  if (String(toAddress).toLowerCase() !== String(addressRow.address).toLowerCase()) {
    return { credited: false, reason: "not_target_address" };
  }

  const decimals = transfer.token_info?.decimals || USDT_DECIMALS;
  const amount = normalizeTronAmount(transfer.value, decimals);

  if (!amount || amount <= 0) {
    return { credited: false, reason: "invalid_amount" };
  }

  const { data: existingDeposit, error: existingErr } = await supabase
    .from("crypto_deposits")
    .select("id, status, credited_at")
    .eq("tx_hash", txHash)
    .maybeSingle();

  if (existingErr) throw existingErr;

  if (existingDeposit?.status === "completed" || existingDeposit?.credited_at) {
    return { credited: false, reason: "already_credited", txHash };
  }

  const { wallet, error: walletErr } = await ensureWallet(addressRow.user_id, "USDT");

  if (walletErr || !wallet) {
    throw walletErr || new Error("Wallet check failed");
  }

  let depositId = existingDeposit?.id || null;

  if (!depositId) {
    const { data: createdDeposit, error: depositInsertErr } = await supabase
      .from("crypto_deposits")
      .insert({
        user_id: addressRow.user_id,
        wallet_id: wallet.id,
        network: "TRON",
        token: "USDT",
        tx_hash: txHash,
        from_address: fromAddress,
        to_address: toAddress,
        amount,
        confirmations: 1,
        status: "pending",
        raw_payload: transfer,
      })
      .select("id")
      .single();

    if (depositInsertErr) {
      if (depositInsertErr.code === "23505") {
        return { credited: false, reason: "duplicate_tx_hash", txHash };
      }
      throw depositInsertErr;
    }

    depositId = createdDeposit.id;
  }

  const currentBalance = Number(wallet.balance || 0);
  const newBalance = currentBalance + amount;

  const { error: balanceErr } = await supabase
    .from("wallets")
    .update({ balance: newBalance })
    .eq("id", wallet.id);

  if (balanceErr) throw balanceErr;

  const { error: txErr } = await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    type: "credit",
    amount,
    description: "USDT TRC20 deposit",
    reference: txHash,
  });

  if (txErr) {
    console.error("[usdt-deposit-scanner] transaction insert error:", txErr);
  }

  const { error: markErr } = await supabase
    .from("crypto_deposits")
    .update({
      status: "completed",
      confirmations: 1,
      credited_at: new Date().toISOString(),
      wallet_id: wallet.id,
    })
    .eq("id", depositId);

  if (markErr) throw markErr;

  return {
    credited: true,
    txHash,
    amount,
    userId: addressRow.user_id,
    address: addressRow.address,
  };
}

async function scanUsdtDeposits() {
  const startedAt = new Date().toISOString();

  const { data: addresses, error: addressErr } = await supabase
    .from("crypto_deposit_addresses")
    .select("user_id, address, network, token")
    .eq("network", "TRON")
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