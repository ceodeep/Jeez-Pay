const crypto = require("crypto");

const KEY_ENV = "KYC_FIELD_ENCRYPTION_KEY";

function getKey() {
  const raw = String(process.env[KEY_ENV] || "").trim();
  if (!raw) {
    throw new Error(`${KEY_ENV}_MISSING`);
  }

  let key;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${KEY_ENV}_INVALID`);
  }

  if (key.length !== 32) {
    throw new Error(`${KEY_ENV}_INVALID_LENGTH`);
  }
  return key;
}

function normalizeDocumentNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function encryptSensitiveText(value) {
  const plaintext = String(value || "").trim();
  if (!plaintext) throw new Error("KYC_SENSITIVE_VALUE_REQUIRED");

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptSensitiveText(encoded) {
  const parts = String(encoded || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("KYC_ENCRYPTED_VALUE_INVALID");
  }

  const key = getKey();
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function fingerprintDocumentNumber(value) {
  const normalized = normalizeDocumentNumber(value);
  if (!normalized) throw new Error("KYC_DOCUMENT_NUMBER_REQUIRED");
  return crypto
    .createHmac("sha256", getKey())
    .update(`document-number:v1:${normalized}`, "utf8")
    .digest("hex");
}

function last4(value) {
  const normalized = normalizeDocumentNumber(value);
  return normalized.slice(-4) || null;
}

module.exports = {
  encryptSensitiveText,
  decryptSensitiveText,
  fingerprintDocumentNumber,
  normalizeDocumentNumber,
  last4,
};
