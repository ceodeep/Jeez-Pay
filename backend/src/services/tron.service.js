const TronWeb = require("tronweb");
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

module.exports = {
  tronWeb,
  createTronAccount,
  encryptPrivateKey,
  decryptPrivateKey,
};