const tronwebPackage = require("tronweb");
const TronWeb = tronwebPackage.TronWeb || tronwebPackage.default || tronwebPackage;
const crypto = require("crypto");

const fullHost = process.env.TRON_FULL_HOST || "https://api.trongrid.io";
const apiKey = process.env.TRONGRID_API_KEY || "";

const tronWeb = new TronWeb({
  fullHost,
  headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
});

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  console.warn("[tron.service] WALLET_ENCRYPTION_KEY is missing or too short");
}

function encryptPrivateKey(privateKey) {
  if (!ENCRYPTION_KEY) {
    throw new Error("WALLET_ENCRYPTION_KEY is required");
  }

  const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function decryptPrivateKey(payload) {
  if (!ENCRYPTION_KEY) {
    throw new Error("WALLET_ENCRYPTION_KEY is required");
  }

  const [ivHex, authTagHex, encryptedHex] = String(payload).split(":");
  const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

async function createTronAccount() {
  const account = await tronWeb.createAccount();

  return {
    address: account.address.base58,
    privateKey: account.privateKey,
  };
}

async function sendUsdtTrc20FromPrivateKey({ fromPrivateKey, toAddress, amount }) {
  if (!fromPrivateKey) {
    throw new Error("Private key is required");
  }

  if (!tronWeb.isAddress(toAddress)) {
    throw new Error("Invalid TRON address");
  }

  const contractAddress = process.env.USDT_TRC20_CONTRACT;

  if (!contractAddress) {
    throw new Error("USDT_TRC20_CONTRACT is missing");
  }

  const senderTronWeb = new TronWeb({
    fullHost,
    privateKey: fromPrivateKey,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
  });

  const contract = await senderTronWeb.contract().at(contractAddress);

  const amountInSun = Math.round(Number(amount) * 1_000_000);

  const txHash = await contract.transfer(toAddress, amountInSun).send({
    feeLimit: 100_000_000,
  });

  await waitForTronTransactionSuccess(txHash);

  return txHash;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTronTransactionSuccess(txHash, attempts = 20, delayMs = 3000) {
  const checkerTronWeb = new TronWeb({
    fullHost,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
  });

  for (let i = 0; i < attempts; i += 1) {
    const info = await checkerTronWeb.trx.getTransactionInfo(txHash);

    if (info && Object.keys(info).length > 0) {
      if (info.receipt?.result === "SUCCESS") {
        return info;
      }

      const reasonHex = info.resMessage;
      let reason = "";

      try {
        reason = reasonHex
          ? Buffer.from(reasonHex, "hex").toString("utf8")
          : "";
      } catch (_) {
        reason = "";
      }

      throw new Error(
        `TRON transaction failed: ${info.receipt?.result || "UNKNOWN"} ${reason}`.trim()
      );
    }

    await sleep(delayMs);
  }

  throw new Error("TRON transaction confirmation timed out");
}

async function waitForTransactionSuccess(txHash, maxAttempts = 20, delayMs = 3000) {
  if (!txHash) {
    throw new Error("Transaction hash is required");
  }

  for (let i = 0; i < maxAttempts; i++) {
    const info = await tronWeb.trx.getTransactionInfo(txHash);

    if (info && Object.keys(info).length > 0) {
      if (info.receipt?.result === "SUCCESS") {
        return info;
      }

      throw new Error(
        info.resMessage
          ? Buffer.from(info.resMessage, "hex").toString("utf8")
          : `Transaction failed: ${info.receipt?.result || "UNKNOWN"}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Transaction confirmation timed out");
}

async function sendTrxFromPrivateKey({ fromPrivateKey, toAddress, amount }) {
  if (!fromPrivateKey) throw new Error("Private key is required");
  if (!tronWeb.isAddress(toAddress)) throw new Error("Invalid TRON address");

  const senderTronWeb = new TronWeb({
    fullHost,
    privateKey: fromPrivateKey,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
  });

  const amountInSun = Math.floor(Number(amount) * 1_000_000);

  const result = await senderTronWeb.trx.sendTransaction(
    toAddress,
    amountInSun
  );

  if (!result?.result) {
    throw new Error(result?.message || "TRX transfer failed");
  }

  return result.txid;
}

async function getUsdtTrc20Balance(address) {
  if (!tronWeb.isAddress(address)) {
    throw new Error("Invalid TRON address");
  }

  const contractAddress = process.env.USDT_TRC20_CONTRACT;

  if (!contractAddress) {
    throw new Error("USDT_TRC20_CONTRACT is missing");
  }

  const ownerAddress =
    process.env.TRON_TREASURY_ADDRESS || address;

  if (!tronWeb.isAddress(ownerAddress)) {
    throw new Error("Valid TRON_TREASURY_ADDRESS is required for balance check");
  }

  const readTronWeb = new TronWeb({
    fullHost,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
  });

  readTronWeb.setAddress(ownerAddress);

  const contract = await readTronWeb.contract().at(contractAddress);
  const result = await contract.balanceOf(address).call();

  let raw;

  if (typeof result === "bigint") {
    raw = result.toString();
  } else if (result?._hex) {
    raw = BigInt(result._hex).toString();
  } else if (Array.isArray(result) && result[0]) {
    raw = result[0].toString();
  } else if (result?.toString) {
    raw = result.toString();
  } else {
    raw = "0";
  }

  return Number(raw) / 1_000_000;
}

module.exports = {
  tronWeb,
  createTronAccount,
  encryptPrivateKey,
  decryptPrivateKey,
  sendUsdtTrc20FromPrivateKey,
  waitForTransactionSuccess,
  sendTrxFromPrivateKey,
  getUsdtTrc20Balance,
};