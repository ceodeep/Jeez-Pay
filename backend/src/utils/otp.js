const crypto = require("crypto");
const { jwtSecret } = require("../config/env");

const OTP_HASH_PATTERN = /^[a-f0-9]{64}$/i;

function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOTP({ email, purpose, code }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPurpose = String(purpose || "").trim().toLowerCase();
  const normalizedCode = String(code || "").trim();

  return crypto
    .createHmac("sha256", jwtSecret)
    .update(`${normalizedEmail}:${normalizedPurpose}:${normalizedCode}`)
    .digest("hex");
}

function verifyOTPHash({ storedHash, email, purpose, code }) {
  const normalizedHash = String(storedHash || "").trim();

  if (!OTP_HASH_PATTERN.test(normalizedHash)) {
    return false;
  }

  const expectedHash = hashOTP({ email, purpose, code });
  const actualBuffer = Buffer.from(normalizedHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function secureRandomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }

  return crypto.randomInt(0, maxExclusive);
}

module.exports = {
  generateOTP,
  hashOTP,
  verifyOTPHash,
  secureRandomIndex,
};
