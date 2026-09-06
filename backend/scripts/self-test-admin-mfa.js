"use strict";

const assert = require("assert");

const originalKey =
  process.env.ADMIN_MFA_ENCRYPTION_KEY;

process.env.ADMIN_MFA_ENCRYPTION_KEY =
  originalKey ||
  (
    "phase9-admin-mfa-self-test-" +
    "0123456789abcdef0123456789abcdef"
  );

const {
  base32Encode,
  base32Decode,
  generateTotp,
  verifyTotp,
  generateTotpSecret,
  buildOtpAuthUri,
  encryptTotpSecret,
  decryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} = require(
  "../src/services/adminMfa.service"
);

function main() {
  // RFC 6238 SHA-1 test vector:
  // secret = "12345678901234567890"
  // time = 59 seconds
  // expected 8-digit token = 94287082.
  const rfcSecret = Buffer.from(
    "12345678901234567890",
    "ascii"
  );

  const encoded =
    base32Encode(rfcSecret);

  assert.strictEqual(
    encoded,
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  );

  assert.deepStrictEqual(
    base32Decode(encoded),
    rfcSecret
  );

  assert.strictEqual(
    generateTotp(
      encoded,
      {
        timeMs: 59000,
        digits: 8,
      }
    ),
    "94287082"
  );

  const secret =
    generateTotpSecret();

  assert.match(
    secret,
    /^[A-Z2-7]+$/
  );

  const now =
    1735689600000;

  const token =
    generateTotp(
      secret,
      {
        timeMs: now,
      }
    );

  assert.match(
    token,
    /^\d{6}$/
  );

  assert.strictEqual(
    verifyTotp(
      secret,
      token,
      {
        timeMs: now,
        window: 0,
      }
    ),
    true
  );

  assert.strictEqual(
    verifyTotp(
      secret,
      "000000",
      {
        timeMs: now,
        window: 0,
      }
    ),
    token === "000000"
  );

  const userId =
    "11111111-1111-4111-8111-111111111111";

  const encrypted =
    encryptTotpSecret(
      userId,
      secret
    );

  assert.ok(
    !encrypted.includes(secret)
  );

  assert.strictEqual(
    decryptTotpSecret(
      userId,
      encrypted
    ),
    secret
  );

  assert.throws(
    () =>
      decryptTotpSecret(
        "22222222-2222-4222-8222-222222222222",
        encrypted
      )
  );

  const uri =
    buildOtpAuthUri({
      secret,
      label:
        "admin@example.invalid",
    });

  assert.ok(
    uri.startsWith(
      "otpauth://totp/"
    )
  );

  assert.ok(
    uri.includes(
      "issuer=JeezPay%20Admin"
    )
  );

  const recoveryCodes =
    generateRecoveryCodes(10);

  assert.strictEqual(
    recoveryCodes.length,
    10
  );

  assert.strictEqual(
    new Set(recoveryCodes).size,
    10
  );

  for (
    const code of recoveryCodes
  ) {
    assert.match(
      code,
      /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/
    );

    const hash =
      hashRecoveryCode(
        userId,
        code
      );

    assert.match(
      hash,
      /^[a-f0-9]{64}$/
    );

    assert.strictEqual(
      hash,
      hashRecoveryCode(
        userId,
        code.replace(/-/g, "")
      )
    );

    assert.notStrictEqual(
      hash,
      hashRecoveryCode(
        "33333333-3333-4333-8333-333333333333",
        code
      )
    );
  }

  console.log(
    "ADMIN MFA CRYPTO SELF-TEST: OK"
  );
}

try {
  main();
} finally {
  if (originalKey === undefined) {
    delete process.env
      .ADMIN_MFA_ENCRYPTION_KEY;
  } else {
    process.env
      .ADMIN_MFA_ENCRYPTION_KEY =
      originalKey;
  }
}
