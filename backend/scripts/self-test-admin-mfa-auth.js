"use strict";

const assert =
  require("assert");

const jwt =
  require("jsonwebtoken");

process.env
  .ADMIN_MFA_ENCRYPTION_KEY =
  (
    "phase9-mfa-auth-test-" +
    "0123456789abcdef0123456789abcdef"
  );

const supabasePath =
  require.resolve(
    "../src/config/supabase"
  );

require.cache[
  supabasePath
] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    from() {
      throw new Error(
        "Unexpected default Supabase access"
      );
    },
    rpc() {
      throw new Error(
        "Unexpected default Supabase RPC"
      );
    },
  },
};

const envPath =
  require.resolve(
    "../src/config/env"
  );

require.cache[
  envPath
] = {
  id: envPath,
  filename: envPath,
  loaded: true,
  exports: {
    jwtSecret:
      "phase9-mfa-jwt-test-secret-0123456789",
  },
};

const cryptoService =
  require(
    "../src/services/adminMfa.service"
  );

const {
  AdminMfaError,
  createAdminMfaAuthService,
} = require(
  "../src/services/adminMfaAuth.service"
);

const NOW =
  1788720000000;

const secret =
  cryptoService
    .generateTotpSecret();

const ciphertext =
  cryptoService
    .encryptTotpSecret(
      "admin-1",
      secret
    );

const recoveryCode =
  cryptoService
    .generateRecoveryCodes(1)[0];

const recoveryHash =
  cryptoService
    .hashRecoveryCode(
      "admin-1",
      recoveryCode
    );

const tables = {
  users: [
    {
      id: "admin-1",
      phone: "+211000000000",
      email:
        "admin@example.invalid",
      pin_hash: "hash",
      role: "admin",
      is_active: true,
    },
  ],

  user_sessions: [
    {
      id: "session-1",
      user_id: "admin-1",
      device_name: "Browser",
      app_platform: "web",
      ip_address: "127.0.0.1",
      user_agent: "test",
      revoked_at: null,
      admin_mfa_verified_at:
        null,
    },
  ],

  admin_mfa_factors_v1: [
    {
      user_id: "admin-1",
      secret_ciphertext:
        ciphertext,
      enabled_at:
        new Date(
          NOW - 100000
        ).toISOString(),
      last_verified_at: null,
      failed_attempts: 0,
      locked_until: null,
    },
  ],

  admin_mfa_recovery_codes_v1: [
    {
      id: "recovery-1",
      user_id: "admin-1",
      code_hash:
        recoveryHash,
      used_at: null,
    },
  ],
};

function matches(
  row,
  filters
) {
  return filters.every(
    ([op, key, value]) => {
      if (op === "eq") {
        return (
          String(row[key]) ===
          String(value)
        );
      }

      if (op === "is") {
        return (
          row[key] === value
        );
      }

      return false;
    }
  );
}

function makeBuilder(
  table
) {
  const rows =
    tables[table];

  assert.ok(
    rows,
    `unknown table ${table}`
  );

  let mode = "select";
  let payload = null;
  let single = false;
  const filters = [];

  async function execute() {
    const matched =
      rows.filter(
        (row) =>
          matches(
            row,
            filters
          )
      );

    if (mode === "select") {
      return {
        data:
          single
            ? (
                matched.length
                  ? {
                      ...matched[0],
                    }
                  : null
              )
            : matched.map(
                (row) => ({
                  ...row,
                })
              ),
        error: null,
      };
    }

    if (mode === "update") {
      for (
        const row of matched
      ) {
        Object.assign(
          row,
          payload
        );
      }

      return {
        data:
          single
            ? (
                matched.length
                  ? {
                      ...matched[0],
                    }
                  : null
              )
            : null,
        error: null,
      };
    }

    throw new Error(
      `unsupported mode ${mode}`
    );
  }

  const builder = {
    select() {
      return builder;
    },

    update(value) {
      mode = "update";
      payload = value;
      return builder;
    },

    eq(key, value) {
      filters.push([
        "eq",
        key,
        value,
      ]);
      return builder;
    },

    is(key, value) {
      filters.push([
        "is",
        key,
        value,
      ]);
      return builder;
    },

    maybeSingle() {
      single = true;
      return execute();
    },

    then(resolve, reject) {
      return execute()
        .then(resolve, reject);
    },
  };

  return builder;
}

const fakeClient = {
  from(table) {
    return makeBuilder(
      table
    );
  },

  async rpc(name, args) {
    assert.strictEqual(
      name,
      "complete_admin_mfa_verification_v1"
    );

    const user =
      tables.users.find(
        (row) =>
          row.id ===
          args.p_user_id &&
          row.is_active
      );

    const factor =
      tables
        .admin_mfa_factors_v1
        .find(
          (row) =>
            row.user_id ===
            args.p_user_id &&
            row.enabled_at
        );

    const session =
      tables.user_sessions
        .find(
          (row) =>
            row.id ===
              args.p_session_id &&
            row.user_id ===
              args.p_user_id &&
            row.revoked_at === null
        );

    if (
      !user ||
      !factor ||
      !session
    ) {
      return {
        data: null,
        error: new Error(
          "invalid state"
        ),
      };
    }

    if (
      args
        .p_require_unverified &&
      session
        .admin_mfa_verified_at
    ) {
      return {
        data: null,
        error: new Error(
          "MFA_CHALLENGE_ALREADY_USED"
        ),
      };
    }

    if (
      args
        .p_recovery_code_hash
    ) {
      const recovery =
        tables
          .admin_mfa_recovery_codes_v1
          .find(
            (row) =>
              row.user_id ===
                args.p_user_id &&
              row.code_hash ===
                args
                  .p_recovery_code_hash &&
              row.used_at ===
                null
          );

      if (!recovery) {
        return {
          data: null,
          error: null,
        };
      }

      recovery.used_at =
        new Date(NOW)
          .toISOString();
    }

    const verifiedAt =
      new Date(NOW)
        .toISOString();

    factor.last_verified_at =
      verifiedAt;

    factor.failed_attempts = 0;
    factor.locked_until = null;

    session.admin_mfa_verified_at =
      verifiedAt;

    return {
      data: verifiedAt,
      error: null,
    };
  },
};

const service =
  createAdminMfaAuthService({
    client:
      fakeClient,

    jwtLib:
      jwt,

    signingSecret:
      "phase9-mfa-jwt-test-secret-0123456789",

    cryptoService,

    now: () => NOW,

    randomUUID:
      () =>
        "11111111-1111-4111-8111-111111111111",
  });

async function expectMfaError(
  promise,
  status,
  code
) {
  let caught = null;

  try {
    await promise;
  } catch (err) {
    caught = err;
  }

  assert.ok(
    caught instanceof
      AdminMfaError
  );

  assert.strictEqual(
    caught.status,
    status
  );

  assert.strictEqual(
    caught.code,
    code
  );
}

async function main() {
  const challenge =
    service
      .createLoginChallenge({
        userId:
          "admin-1",

        sessionId:
          "session-1",
      });

  const decoded =
    jwt.decode(challenge);

  /*
   * Critical property: this short-lived challenge
   * is structurally unusable by auth.middleware.
   */
  assert.strictEqual(
    decoded.userId,
    undefined
  );

  assert.strictEqual(
    decoded.sessionId,
    undefined
  );

  assert.strictEqual(
    decoded.sub,
    "admin-1"
  );

  assert.strictEqual(
    decoded.sid,
    "session-1"
  );

  assert.strictEqual(
    decoded.purpose,
    "admin_mfa_login"
  );

  const parsed =
    service
      .verifyLoginChallenge(
        challenge
      );

  assert.deepStrictEqual(
    parsed,
    {
      userId:
        "admin-1",

      sessionId:
        "session-1",
    }
  );

  const validToken =
    cryptoService
      .generateTotp(
        secret,
        {
          timeMs: NOW,
        }
      );

  const wrongToken =
    validToken === "000000"
      ? "000001"
      : "000000";

  await expectMfaError(
    service.verifyForSession({
      userId:
        "admin-1",

      sessionId:
        "session-1",

      token:
        wrongToken,

      requireUnverified:
        true,
    }),

    401,
    "INVALID_MFA_CODE"
  );

  assert.strictEqual(
    tables
      .admin_mfa_factors_v1[0]
      .failed_attempts,
    1
  );

  const result =
    await service
      .verifyForSession({
        userId:
          "admin-1",

        sessionId:
          "session-1",

        token:
          validToken,

        requireUnverified:
          true,
      });

  assert.ok(
    result.verifiedAt
  );

  assert.strictEqual(
    result.usedRecovery,
    false
  );

  assert.ok(
    tables
      .user_sessions[0]
      .admin_mfa_verified_at
  );

  await expectMfaError(
    service.verifyForSession({
      userId:
        "admin-1",

      sessionId:
        "session-1",

      token:
        validToken,

      requireUnverified:
        true,
    }),

    409,
    "MFA_CHALLENGE_ALREADY_USED"
  );

  tables.user_sessions.push({
    id: "session-2",
    user_id: "admin-1",
    device_name: "Recovery login",
    app_platform: "web",
    ip_address: "127.0.0.1",
    user_agent: "test",
    revoked_at: null,
    admin_mfa_verified_at:
      null,
  });

  const recoveryResult =
    await service
      .verifyForSession({
        userId:
          "admin-1",

        sessionId:
          "session-2",

        recoveryCode,

        requireUnverified:
          true,
      });

  assert.strictEqual(
    recoveryResult
      .usedRecovery,
    true
  );

  assert.ok(
    tables
      .admin_mfa_recovery_codes_v1[0]
      .used_at
  );

  const assurance =
    await service
      .getAssurance({
        userId:
          "admin-1",

        sessionId:
          "session-2",
      });

  assert.strictEqual(
    assurance.enabled,
    true
  );

  assert.strictEqual(
    assurance.fresh,
    true
  );

  tables.user_sessions.push({
    id: "pending-old",
    user_id: "admin-1",
    device_name: "Pending",
    app_platform: "web",
    ip_address: null,
    user_agent: "",
    revoked_at: null,
    admin_mfa_verified_at:
      null,
  });

  await service
    .revokeUnverifiedSessions(
      "admin-1"
    );

  assert.ok(
    tables.user_sessions
      .find(
        (row) =>
          row.id ===
          "pending-old"
      )
      .revoked_at
  );

  assert.strictEqual(
    tables.user_sessions
      .find(
        (row) =>
          row.id ===
          "session-2"
      )
      .revoked_at,
    null
  );

  console.log(
    "ADMIN MFA AUTH SELF-TEST: OK"
  );
}

main().catch((err) => {
  console.error(
    "ADMIN MFA AUTH SELF-TEST FAILED:",
    err
  );

  process.exit(1);
});
