"use strict";

const assert = require("assert");
const path = require("path");

process.env.JWT_SECRET =
  "phase9-session-self-test-jwt-secret";

process.env.OTP_HASH_SECRET =
  "phase9-session-self-test-otp-secret";

const jwt = require("jsonwebtoken");

const sessions = new Map();
const users = new Map();

function matches(row, filters) {
  return filters.every((filter) => {
    const [op, key, value] = filter;

    if (op === "eq") {
      return String(row[key]) === String(value);
    }

    if (op === "neq") {
      return String(row[key]) !== String(value);
    }

    if (op === "is") {
      return row[key] === value;
    }

    return false;
  });
}

function makeBuilder(table) {
  const source =
    table === "user_sessions"
      ? sessions
      : table === "users"
        ? users
        : null;

  assert.ok(
    source,
    `Unexpected table: ${table}`
  );

  let mode = "select";
  let updatePayload = null;
  let returnRows = false;

  const filters = [];

  const execute = async () => {
    const rows = [...source.values()]
      .filter((row) => matches(row, filters));

    if (mode === "select") {
      return {
        data: rows.length ? { ...rows[0] } : null,
        error: null,
      };
    }

    for (const row of rows) {
      Object.assign(row, updatePayload);
    }

    return {
      data:
        returnRows && rows.length
          ? { ...rows[0] }
          : null,
      error: null,
    };
  };

  const builder = {
    select() {
      returnRows = true;
      return builder;
    },

    update(payload) {
      mode = "update";
      updatePayload = payload;
      return builder;
    },

    eq(key, value) {
      filters.push(["eq", key, value]);
      return builder;
    },

    neq(key, value) {
      filters.push(["neq", key, value]);
      return builder;
    },

    is(key, value) {
      filters.push(["is", key, value]);
      return builder;
    },

    maybeSingle() {
      return execute();
    },

    then(resolve, reject) {
      return execute().then(resolve, reject);
    },
  };

  return builder;
}

const fakeSupabase = {
  from(table) {
    return makeBuilder(table);
  },
};

const supabasePath = require.resolve(
  "../src/config/supabase"
);

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: fakeSupabase,
};

const middlewarePath = require.resolve(
  "../src/middlewares/auth.middleware"
);

delete require.cache[middlewarePath];

const authMiddleware = require(
  "../src/middlewares/auth.middleware"
);

const {
  revokeUserSessions,
  revokeCurrentSession,
} = require("../src/services/session.service");

const secret = process.env.JWT_SECRET;

async function invokeAuth(payload) {
  const token = jwt.sign(
    payload,
    secret,
    { expiresIn: "5m" }
  );

  let statusCode = 200;
  let body = null;
  let nextCalled = false;

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },

    json(value) {
      body = value;
      return res;
    },
  };

  await authMiddleware(
    req,
    res,
    () => {
      nextCalled = true;
    }
  );

  return {
    statusCode,
    body,
    nextCalled,
    req,
  };
}

async function main() {
  sessions.clear();
  users.clear();

  let result = await invokeAuth({
    userId: "user-1",
  });

  assert.strictEqual(result.statusCode, 401);
  assert.strictEqual(result.nextCalled, false);

  result = await invokeAuth({
    userId: "user-1",
    sessionId: "missing-session",
  });

  assert.strictEqual(result.statusCode, 401);
  assert.strictEqual(result.nextCalled, false);

  sessions.set("revoked-session", {
    id: "revoked-session",
    user_id: "user-1",
    revoked_at: new Date().toISOString(),
    last_seen_at: null,
  });

  result = await invokeAuth({
    userId: "user-1",
    sessionId: "revoked-session",
  });

  assert.strictEqual(result.statusCode, 401);
  assert.strictEqual(result.nextCalled, false);

  users.set("user-1", {
    id: "user-1",
    is_active: true,
  });

  sessions.set("active-session", {
    id: "active-session",
    user_id: "user-1",
    revoked_at: null,
    last_seen_at: null,
  });

  result = await invokeAuth({
    userId: "user-1",
    sessionId: "active-session",
  });

  assert.strictEqual(result.statusCode, 200);
  assert.strictEqual(result.nextCalled, true);
  assert.strictEqual(
    result.req.user.sessionId,
    "active-session"
  );

  sessions.clear();

  sessions.set("keep-session", {
    id: "keep-session",
    user_id: "user-2",
    revoked_at: null,
  });

  sessions.set("other-session", {
    id: "other-session",
    user_id: "user-2",
    revoked_at: null,
  });

  await revokeUserSessions(
    "user-2",
    {
      exceptSessionId: "keep-session",
    }
  );

  assert.strictEqual(
    sessions.get("keep-session").revoked_at,
    null
  );

  assert.ok(
    sessions.get("other-session").revoked_at
  );

  sessions.get("keep-session").revoked_at = null;
  sessions.get("other-session").revoked_at = null;

  await revokeUserSessions("user-2");

  assert.ok(
    sessions.get("keep-session").revoked_at
  );

  assert.ok(
    sessions.get("other-session").revoked_at
  );

  sessions.set("logout-session", {
    id: "logout-session",
    user_id: "user-3",
    revoked_at: null,
  });

  const revoked = await revokeCurrentSession(
    "user-3",
    "logout-session"
  );

  assert.strictEqual(revoked, true);

  assert.ok(
    sessions.get("logout-session").revoked_at
  );

  console.log(
    "AUTH SESSION SELF-TEST: OK"
  );
}

main().catch((err) => {
  console.error(
    "AUTH SESSION SELF-TEST FAILED:",
    err
  );

  process.exit(1);
});
