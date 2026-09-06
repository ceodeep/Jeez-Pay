"use strict";

const assert = require("assert");

const originalKey =
  process.env.ADMIN_MFA_ENCRYPTION_KEY;

process.env.ADMIN_MFA_ENCRYPTION_KEY =
  originalKey ||
  (
    "phase9-admin-mfa-enrollment-test-" +
    "0123456789abcdef0123456789abcdef"
  );

const cryptoService = require(
  "../src/services/adminMfa.service"
);

/*
 * The enrollment service normally imports the production
 * Supabase singleton at module load time.
 *
 * This standalone self-test injects a harmless stub before
 * requiring the service. Individual tests then pass their
 * own fakeClient explicitly.
 *
 * This keeps the self-test isolated from .env and prevents
 * any accidental production Supabase access.
 */
const supabasePath = require.resolve(
  "../src/config/supabase"
);

const phase9MfaSupabaseStub = {
  from() {
    throw new Error(
      "Unexpected use of default Supabase client in MFA self-test"
    );
  },

  rpc() {
    throw new Error(
      "Unexpected use of default Supabase RPC client in MFA self-test"
    );
  },
};

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: phase9MfaSupabaseStub,
};

const {
  AdminMfaError,
  createAdminMfaEnrollmentService,
} = require(
  "../src/services/adminMfaEnrollment.service"
);

const NOW = 1760000000000;

const tables = {
  users: [
    {
      id: "admin-1",
      email: "admin@example.invalid",
      phone: "+211000000000",
      password_hash: "password-hash",
      role: "admin",
      is_active: true,
    },
  ],

  user_sessions: [
    {
      id: "session-1",
      user_id: "admin-1",
      revoked_at: null,
      admin_mfa_verified_at: null,
    },
    {
      id: "session-2",
      user_id: "admin-1",
      revoked_at: null,
      admin_mfa_verified_at: null,
    },
  ],

  admin_mfa_factors_v1: [],
  admin_mfa_recovery_codes_v1: [],
};

function matches(row, filters) {
  return filters.every(
    ([op, key, value]) => {
      if (op === "eq") {
        return String(row[key]) === String(value);
      }

      if (op === "is") {
        return row[key] === value;
      }

      return false;
    }
  );
}

function makeBuilder(table) {
  const rows = tables[table];

  assert.ok(
    rows,
    `unknown table ${table}`
  );

  let mode = "select";
  let payload = null;
  let single = false;
  const filters = [];

  async function execute() {
    const matched = rows.filter(
      (row) => matches(row, filters)
    );

    if (mode === "select") {
      return {
        data: single
          ? (
              matched.length
                ? { ...matched[0] }
                : null
            )
          : matched.map(
              (row) => ({ ...row })
            ),
        error: null,
      };
    }

    if (mode === "delete") {
      for (
        let i = rows.length - 1;
        i >= 0;
        i -= 1
      ) {
        if (matches(rows[i], filters)) {
          rows.splice(i, 1);
        }
      }

      return {
        data: null,
        error: null,
      };
    }

    if (mode === "upsert") {
      const existing = rows.find(
        (row) =>
          String(row.user_id) ===
          String(payload.user_id)
      );

      if (existing) {
        Object.assign(existing, payload);
      } else {
        rows.push({ ...payload });
      }

      return {
        data: null,
        error: null,
      };
    }

    if (mode === "update") {
      for (const row of matched) {
        Object.assign(row, payload);
      }

      return {
        data: single
          ? (
              matched.length
                ? { ...matched[0] }
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

    upsert(value) {
      mode = "upsert";
      payload = value;
      return builder;
    },

    update(value) {
      mode = "update";
      payload = value;
      return builder;
    },

    delete() {
      mode = "delete";
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

let failFinalize = false;

const fakeClient = {
  from(table) {
    return makeBuilder(table);
  },

  async rpc(name, args) {
    assert.strictEqual(
      name,
      "finalize_admin_mfa_enrollment_v1"
    );

    if (failFinalize) {
      return {
        data: null,
        error: new Error(
          "simulated transaction failure"
        ),
      };
    }

    const {
      p_user_id: userId,
      p_session_id: sessionId,
      p_recovery_code_hashes: hashes,
    } = args;

    assert.strictEqual(
      hashes.length,
      10
    );

    assert.strictEqual(
      new Set(hashes).size,
      10
    );

    const factor =
      tables.admin_mfa_factors_v1
        .find(
          (row) =>
            row.user_id === userId
        );

    const current =
      tables.user_sessions
        .find(
          (row) =>
            row.id === sessionId &&
            row.user_id === userId &&
            row.revoked_at === null
        );

    if (
      !factor ||
      factor.enabled_at ||
      !current
    ) {
      return {
        data: null,
        error: new Error(
          "invalid finalization state"
        ),
      };
    }

    const enabledAt =
      new Date(NOW).toISOString();

    tables.admin_mfa_recovery_codes_v1 =
      hashes.map(
        (hash, index) => ({
          id: `recovery-${index}`,
          user_id: userId,
          code_hash: hash,
          used_at: null,
        })
      );

    factor.enabled_at = enabledAt;
    factor.last_verified_at = enabledAt;
    factor.failed_attempts = 0;
    factor.locked_until = null;

    for (
      const session of
      tables.user_sessions
    ) {
      if (
        session.user_id === userId &&
        session.id !== sessionId &&
        session.revoked_at === null
      ) {
        session.revoked_at = enabledAt;
      }
    }

    current.admin_mfa_verified_at =
      enabledAt;

    return {
      data: enabledAt,
      error: null,
    };
  },
};

const fakeBcrypt = {
  async compare(password, hash) {
    return (
      password === "correct-password" &&
      hash === "password-hash"
    );
  },
};

const service =
  createAdminMfaEnrollmentService({
    client: fakeClient,
    bcryptLib: fakeBcrypt,
    cryptoService,
    now: () => NOW,
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
    caught instanceof AdminMfaError
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
  let status =
    await service.getStatus({
      userId: "admin-1",
      sessionId: "session-1",
    });

  assert.strictEqual(
    status.enabled,
    false
  );

  await expectMfaError(
    service.startEnrollment({
      userId: "admin-1",
      sessionId: "session-1",
      password: "wrong-password",
    }),
    401,
    "INVALID_CREDENTIALS"
  );

  const setup =
    await service.startEnrollment({
      userId: "admin-1",
      sessionId: "session-1",
      password: "correct-password",
    });

  assert.match(
    setup.secret,
    /^[A-Z2-7]+$/
  );

  const factor =
    tables.admin_mfa_factors_v1[0];

  assert.ok(factor);

  assert.strictEqual(
    factor.enabled_at,
    null
  );

  assert.ok(
    !factor.secret_ciphertext
      .includes(setup.secret)
  );

  const validToken =
    cryptoService.generateTotp(
      setup.secret,
      {
        timeMs: NOW,
      }
    );

  const wrongToken =
    validToken === "000000"
      ? "000001"
      : "000000";

  await expectMfaError(
    service.confirmEnrollment({
      userId: "admin-1",
      sessionId: "session-1",
      token: wrongToken,
    }),
    401,
    "INVALID_MFA_CODE"
  );

  assert.strictEqual(
    factor.failed_attempts,
    1
  );

  /*
   * Prove an RPC failure does not partially
   * enable MFA from the service perspective.
   */
  failFinalize = true;

  await expectMfaError(
    service.confirmEnrollment({
      userId: "admin-1",
      sessionId: "session-1",
      token: validToken,
    }),
    500,
    "MFA_FINALIZE_FAILED"
  );

  assert.strictEqual(
    factor.enabled_at,
    null
  );

  assert.strictEqual(
    tables
      .admin_mfa_recovery_codes_v1
      .length,
    0
  );

  assert.strictEqual(
    tables.user_sessions[1]
      .revoked_at,
    null
  );

  failFinalize = false;

  const confirmed =
    await service.confirmEnrollment({
      userId: "admin-1",
      sessionId: "session-1",
      token: validToken,
    });

  assert.strictEqual(
    confirmed.enabled,
    true
  );

  assert.strictEqual(
    confirmed.recoveryCodes.length,
    10
  );

  assert.strictEqual(
    new Set(
      confirmed.recoveryCodes
    ).size,
    10
  );

  assert.ok(factor.enabled_at);
  assert.ok(factor.last_verified_at);

  assert.strictEqual(
    tables
      .admin_mfa_recovery_codes_v1
      .length,
    10
  );

  const current =
    tables.user_sessions.find(
      (row) =>
        row.id === "session-1"
    );

  const other =
    tables.user_sessions.find(
      (row) =>
        row.id === "session-2"
    );

  assert.ok(
    current.admin_mfa_verified_at
  );

  assert.strictEqual(
    current.revoked_at,
    null
  );

  assert.ok(other.revoked_at);

  status =
    await service.getStatus({
      userId: "admin-1",
      sessionId: "session-1",
    });

  assert.strictEqual(
    status.enabled,
    true
  );

  assert.strictEqual(
    status.recoveryCodesRemaining,
    10
  );

  console.log(
    "ADMIN MFA ENROLLMENT SELF-TEST: OK"
  );
}

main()
  .finally(() => {
    if (originalKey === undefined) {
      delete process.env
        .ADMIN_MFA_ENCRYPTION_KEY;
    } else {
      process.env.ADMIN_MFA_ENCRYPTION_KEY =
        originalKey;
    }
  })
  .catch((err) => {
    console.error(
      "ADMIN MFA ENROLLMENT SELF-TEST FAILED:",
      err
    );
    process.exit(1);
  });
