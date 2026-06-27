const supabase = require("../config/supabase");
const { ethers } = require("ethers");

const BSC_RPC_URL = process.env.BSC_RPC_URL;
const USDT_BEP20_CONTRACT = process.env.USDT_BEP20_CONTRACT;

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

function getProvider() {
  if (!BSC_RPC_URL) throw new Error("BSC_RPC_URL is missing");
  return new ethers.JsonRpcProvider(BSC_RPC_URL);
}

function normalizeBep20Amount(value, decimals) {
  return Number(ethers.formatUnits(value, decimals));
}

function roundUsdt(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBep20DepositFee({ amount }) {
  const networkFeeUsdt = Number(process.env.BEP20_NETWORK_FEE_USDT || 0.05);
  const platformFeeUsdt = Number(process.env.BEP20_PLATFORM_FEE_USDT || 0.95);

  const totalFeeUsdt = roundUsdt(networkFeeUsdt + platformFeeUsdt);
  const netAmount = roundUsdt(Number(amount) - totalFeeUsdt);

  return {
    fee_model: "bep20_fixed_fee_v1",
    gross_amount: roundUsdt(amount),
    network_fee_usdt: roundUsdt(networkFeeUsdt),
    platform_fee_usdt: roundUsdt(platformFeeUsdt),
    total_fee_usdt: totalFeeUsdt,
    net_amount: netAmount,
    fee_currency: "USDT",
  };
}

async function creditBep20DepositOnce({ addressRow, transfer, tokenDecimals }) {
  const txHash = transfer.transactionHash;
  const fromAddress = transfer.args.from;
  const toAddress = transfer.args.to;
  const amount = normalizeBep20Amount(transfer.args.value, tokenDecimals);

  if (!txHash || !toAddress || amount <= 0) {
    return { credited: false, reason: "invalid_transfer", txHash };
  }

  if (
    String(toAddress).toLowerCase() !==
    String(addressRow.address).toLowerCase()
  ) {
    return { credited: false, reason: "not_target_address", txHash };
  }

  const fee = calculateBep20DepositFee({ amount });

  if (fee.net_amount <= 0) {
    return {
      credited: false,
      reason: "deposit_amount_too_small_after_fee",
      txHash,
      amount,
      fee,
    };
  }

  const { data, error } = await supabase.rpc("credit_usdt_bep20_deposit", {
    p_user_id: addressRow.user_id,
    p_tx_hash: txHash,
    p_from_address: fromAddress,
    p_to_address: toAddress,
    p_amount: amount,
    p_raw_payload: {
      transactionHash: txHash,
      from: fromAddress,
      to: toAddress,
      amount,
      blockNumber: transfer.blockNumber,
      network: "BEP20",
      jeezpay_fee: fee,
    },
  });

  if (error) throw error;

  return (
    data || {
      credited: false,
      reason: "empty_rpc_response",
      txHash,
    }
  );
}

async function queryTransfersInChunks({
  contract,
  address,
  fromBlock,
  toBlock,
}) {
  const chunkSize = Number(process.env.BEP20_LOGS_CHUNK_SIZE || 10);
  const delayMs = Number(process.env.BEP20_SCAN_CHUNK_DELAY_MS || 150);

  const allTransfers = [];

  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += chunkSize) {
    const chunkTo = Math.min(chunkFrom + chunkSize - 1, toBlock);

    const filter = contract.filters.Transfer(null, address);
    const transfers = await contract.queryFilter(filter, chunkFrom, chunkTo);

    allTransfers.push(...transfers);

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return allTransfers;
}

async function scanUsdtBep20Deposits() {
  const startedAt = new Date().toISOString();

  if (!USDT_BEP20_CONTRACT) {
    throw new Error("USDT_BEP20_CONTRACT is missing");
  }

  const provider = getProvider();
  const contract = new ethers.Contract(
    USDT_BEP20_CONTRACT,
    ERC20_ABI,
    provider
  );

  const latestBlock = await provider.getBlockNumber();
  const tokenDecimals = Number(await contract.decimals());

  const { data: state, error: stateErr } = await supabase
    .from("scanner_state")
    .select("last_block")
    .eq("scanner_name", "bep20_usdt")
    .maybeSingle();

  if (stateErr) throw stateErr;

  let fromBlock = Number(state?.last_block || 0) + 1;

  if (!fromBlock || fromBlock <= 1) {
    const initialLookback = Number(
      process.env.BEP20_SCAN_INITIAL_LOOKBACK_BLOCKS || 5000
    );

    fromBlock = Math.max(latestBlock - initialLookback, 0);
  }

  if (fromBlock > latestBlock) {
    return {
      message: "BEP20 scanner already up to date",
      startedAt,
      finishedAt: new Date().toISOString(),
      latestBlock,
      fromBlock,
      toBlock: latestBlock,
      scannedAddresses: 0,
      detectedDeposits: 0,
      creditedDeposits: 0,
      errors: [],
    };
  }

  const maxRange = Number(process.env.BEP20_SCAN_MAX_BLOCK_RANGE || 500);
  const toBlock = Math.min(fromBlock + maxRange - 1, latestBlock);

  const { data: addresses, error: addressErr } = await supabase
    .from("crypto_deposit_addresses")
    .select("user_id, address, network, token")
    .eq("network", "BEP20")
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
      const transfers = await queryTransfersInChunks({
        contract,
        address: addressRow.address,
        fromBlock,
        toBlock,
      });

      for (const transfer of transfers) {
        detectedDeposits += 1;

        try {
          const result = await creditBep20DepositOnce({
            addressRow,
            transfer,
            tokenDecimals,
          });

          if (result.credited) {
            creditedDeposits += 1;
            credited.push(result);
          } else {
            skipped.push(result);
          }
        } catch (err) {
          errors.push({
            address: addressRow.address,
            txHash: transfer.transactionHash || null,
            message: err.message || "Credit failed",
          });
        }
      }
    } catch (err) {
      errors.push({
        address: addressRow.address,
        message: err.message || "Address scan failed",
      });
    }
  }

  await supabase.from("scanner_state").upsert({
    scanner_name: "bep20_usdt",
    last_block: toBlock,
    updated_at: new Date().toISOString(),
  });

  return {
    message: "BEP20 deposit scan completed",
    startedAt,
    finishedAt: new Date().toISOString(),
    latestBlock,
    fromBlock,
    toBlock,
    scannedBlocks: toBlock - fromBlock + 1,
    scannedAddresses,
    detectedDeposits,
    creditedDeposits,
    credited,
    skippedCount: skipped.length,
    errors,
  };
}

module.exports = {
  scanUsdtBep20Deposits,
};