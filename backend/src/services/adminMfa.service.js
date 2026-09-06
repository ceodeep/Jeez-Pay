"use strict";

const crypto = require("crypto");

const BASE32 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const RECOVERY_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

function getMasterSecret() {
  const value = String(
    process.env.ADMIN_MFA_ENCRYPTION_KEY || ""
  );

  if (value.length < 32) {
    throw new Error(
      "ADMIN_MFA_ENCRYPTION_KEY must be at least 32 characters"
    );
  }

  return value;
}

function deriveKey(label) {
  return crypto
    .createHash("sha256")
    .update(
      `jeezpay:${label}:v1\0${getMasterSecret()}`,
      "utf8"
    )
    .digest();
}

function base32Encode(input) {
  const bytes = Buffer.from(input);

  let output = "";
  let value = 0;
  let bits = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32[
        (value >>> (bits - 5)) & 31
      ];

      bits -= 5;
    }

    if (bits > 0) {
      value &= (1 << bits) - 1;
    } else {
      value = 0;
    }
  }

  if (bits > 0) {
    output += BASE32[
      (value << (5 - bits)) & 31
    ];
  }

  return output;
}

function base32Decode(secret) {
  const normalized = String(secret || "")
    .toUpperCase()
    .replace(/[\s=]/g, "");

  if (!normalized) {
    throw new Error("TOTP secret is required");
  }

  const output = [];

  let value = 0;
  let bits = 0;

  for (const char of normalized) {
    const index = BASE32.indexOf(char);

    if (index < 0) {
      throw new Error(
        "Invalid base32 TOTP secret"
      );
    }

    value = (value << 5) | index;
    bits += 5;

    while (bits >= 8) {
      output.push(
        (value >>> (bits - 8)) & 0xff
      );

      bits -= 8;
    }

    if (bits > 0) {
      value &= (1 << bits) - 1;
    } else {
      value = 0;
    }
  }

  return Buffer.from(output);
}

function generateTotp(
  secret,
  {
    timeMs = Date.now(),
    digits = TOTP_DIGITS,
    periodSeconds = TOTP_PERIOD_SECONDS,
  } = {}
) {
  if (
    !Number.isInteger(digits) ||
    digits < 6 ||
    digits > 8
  ) {
    throw new Error("Invalid TOTP digits");
  }

  if (
    !Number.isInteger(periodSeconds) ||
    periodSeconds < 15 ||
    periodSeconds > 120
  ) {
    throw new Error("Invalid TOTP period");
  }

  const secretBytes = Buffer.isBuffer(secret)
    ? secret
    : base32Decode(secret);

  const counter = BigInt(
    Math.floor(
      Number(timeMs) /
        1000 /
        periodSeconds
    )
  );

  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(counter);

  const digest = crypto
    .createHmac("sha1", secretBytes)
    .update(counterBuffer)
    .digest();

  const offset =
    digest[digest.length - 1] & 0x0f;

  const binary =
    digest.readUInt32BE(offset) &
    0x7fffffff;

  const modulo = 10 ** digits;

  return String(binary % modulo)
    .padStart(digits, "0");
}

function safeEqualString(a, b) {
  const left = Buffer.from(
    String(a),
    "utf8"
  );

  const right = Buffer.from(
    String(b),
    "utf8"
  );

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    left,
    right
  );
}

function verifyTotp(
  secret,
  token,
  {
    timeMs = Date.now(),
    window = 1,
  } = {}
) {
  const normalizedToken =
    String(token || "").trim();

  if (!/^\d{6}$/.test(normalizedToken)) {
    return false;
  }

  if (
    !Number.isInteger(window) ||
    window < 0 ||
    window > 2
  ) {
    throw new Error("Invalid TOTP window");
  }

  for (
    let offset = -window;
    offset <= window;
    offset += 1
  ) {
    const expected = generateTotp(
      secret,
      {
        timeMs:
          Number(timeMs) +
          offset *
            TOTP_PERIOD_SECONDS *
            1000,
      }
    );

    if (
      safeEqualString(
        normalizedToken,
        expected
      )
    ) {
      return true;
    }
  }

  return false;
}

function generateTotpSecret() {
  return base32Encode(
    crypto.randomBytes(20)
  );
}

function buildOtpAuthUri({
  secret,
  label,
  issuer = "JeezPay Admin",
}) {
  const normalizedSecret =
    String(secret || "").trim();

  const normalizedLabel =
    String(label || "").trim();

  if (!normalizedSecret) {
    throw new Error("TOTP secret required");
  }

  if (!normalizedLabel) {
    throw new Error("TOTP label required");
  }

  const path = encodeURIComponent(
    `${issuer}:${normalizedLabel}`
  );

  const issuerEncoded =
    encodeURIComponent(issuer);

  return (
    `otpauth://totp/${path}` +
    `?secret=${encodeURIComponent(normalizedSecret)}` +
    `&issuer=${issuerEncoded}` +
    "&algorithm=SHA1" +
    "&digits=6" +
    "&period=30"
  );
}

function encryptTotpSecret(
  userId,
  secret
) {
  const normalizedUserId =
    String(userId || "").trim();

  const normalizedSecret =
    String(secret || "").trim();

  if (!normalizedUserId) {
    throw new Error("MFA userId required");
  }

  if (!normalizedSecret) {
    throw new Error("MFA secret required");
  }

  const key = deriveKey(
    "admin-mfa-secret"
  );

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  cipher.setAAD(
    Buffer.from(
      `admin-mfa:${normalizedUserId}`,
      "utf8"
    )
  );

  const encrypted = Buffer.concat([
    cipher.update(
      normalizedSecret,
      "utf8"
    ),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function decryptTotpSecret(
  userId,
  payload
) {
  const normalizedUserId =
    String(userId || "").trim();

  const parts = String(payload || "")
    .split(":");

  if (
    !normalizedUserId ||
    parts.length !== 4 ||
    parts[0] !== "v1"
  ) {
    throw new Error(
      "Invalid MFA ciphertext"
    );
  }

  const [, ivHex, tagHex, encryptedHex] =
    parts;

  const key = deriveKey(
    "admin-mfa-secret"
  );

  const decipher =
    crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    );

  decipher.setAAD(
    Buffer.from(
      `admin-mfa:${normalizedUserId}`,
      "utf8"
    )
  );

  decipher.setAuthTag(
    Buffer.from(tagHex, "hex")
  );

  const decrypted = Buffer.concat([
    decipher.update(
      Buffer.from(
        encryptedHex,
        "hex"
      )
    ),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function normalizeRecoveryCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generateRecoveryCode() {
  let raw = "";

  for (let i = 0; i < 16; i += 1) {
    raw += RECOVERY_ALPHABET[
      crypto.randomInt(
        RECOVERY_ALPHABET.length
      )
    ];
  }

  return raw.match(/.{1,4}/g).join("-");
}

function generateRecoveryCodes(
  count = 10
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20
  ) {
    throw new Error(
      "Invalid recovery-code count"
    );
  }

  const codes = new Set();

  while (codes.size < count) {
    codes.add(
      generateRecoveryCode()
    );
  }

  return [...codes];
}

function hashRecoveryCode(
  userId,
  code
) {
  const normalizedUserId =
    String(userId || "").trim();

  const normalizedCode =
    normalizeRecoveryCode(code);

  if (!normalizedUserId) {
    throw new Error("MFA userId required");
  }

  if (normalizedCode.length !== 16) {
    throw new Error(
      "Invalid recovery code"
    );
  }

  return crypto
    .createHmac(
      "sha256",
      deriveKey(
        "admin-mfa-recovery"
      )
    )
    .update(
      `${normalizedUserId}:${normalizedCode}`,
      "utf8"
    )
    .digest("hex");
}

module.exports = {
  TOTP_PERIOD_SECONDS,
  TOTP_DIGITS,
  base32Encode,
  base32Decode,
  generateTotp,
  verifyTotp,
  generateTotpSecret,
  buildOtpAuthUri,
  encryptTotpSecret,
  decryptTotpSecret,
  normalizeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
};
