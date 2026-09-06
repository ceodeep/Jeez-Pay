"use strict";

const assert =
  require("assert");

const jwt =
  require("jsonwebtoken");

process.env.JWT_SECRET =
  "phase9-active-status-self-test-secret";

const sessions =
  new Map();

const users =
  new Map();

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

function rowsFor(table) {
  if (
    table ===
    "user_sessions"
  ) {
    return sessions;
  }

  if (table === "users") {
    return users;
  }

  throw new Error(
    `Unexpected table: ${table}`
  );
}

function makeBuilder(table) {
  const source =
    rowsFor(table);

  let mode =
    "select";

  let updatePayload =
    null;

  const filters = [];

  async function execute() {
    const rows =
      [...source.values()]
        .filter(
          (row) =>
            matches(
              row,
              filters
            )
        );

    if (
      mode === "update"
    ) {
      for (const row of rows) {
        Object.assign(
          row,
          updatePayload
        );
      }

      return {
        data: null,
        error: null,
      };
    }

    return {
      data:
        rows.length
          ? {
              ...rows[0],
            }
          : null,

      error: null,
    };
  }

  const builder = {
    select() {
      return builder;
    },

    update(payload) {
      mode = "update";
      updatePayload = payload;
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
      return execute();
    },

    then(resolve, reject) {
      return execute()
        .then(resolve, reject);
    },
  };

  return builder;
}

const fakeSupabase = {
  from(table) {
    return makeBuilder(table);
  },
};

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
  exports: fakeSupabase,
};

const middlewarePath =
  require.resolve(
    "../src/middlewares/auth.middleware"
  );

delete require.cache[
  middlewarePath
];

const authMiddleware =
  require(
    "../src/middlewares/auth.middleware"
  );

async function invoke({
  userId,
  sessionId,
}) {
  const token =
    jwt.sign(
      {
        userId,
        sessionId,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "5m",
      }
    );

  let statusCode = 200;
  let body = null;
  let nextCalled = false;

  const req = {
    headers: {
      authorization:
        `Bearer ${token}`,
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

  users.set(
    "active-user",
    {
      id:
        "active-user",
      is_active: true,
    }
  );

  sessions.set(
    "active-session",
    {
      id:
        "active-session",
      user_id:
        "active-user",
      revoked_at: null,
      last_seen_at: null,
    }
  );

  let result =
    await invoke({
      userId:
        "active-user",

      sessionId:
        "active-session",
    });

  assert.strictEqual(
    result.statusCode,
    200
  );

  assert.strictEqual(
    result.nextCalled,
    true
  );

  assert.strictEqual(
    result.req.user.sessionId,
    "active-session"
  );

  users.set(
    "suspended-user",
    {
      id:
        "suspended-user",
      is_active: false,
    }
  );

  sessions.set(
    "suspended-session",
    {
      id:
        "suspended-session",
      user_id:
        "suspended-user",
      revoked_at: null,
      last_seen_at: null,
    }
  );

  result =
    await invoke({
      userId:
        "suspended-user",

      sessionId:
        "suspended-session",
    });

  assert.strictEqual(
    result.statusCode,
    403
  );

  assert.strictEqual(
    result.nextCalled,
    false
  );

  assert.strictEqual(
    result.body.code,
    "ACCOUNT_SUSPENDED"
  );

  assert.ok(
    sessions.get(
      "suspended-session"
    ).revoked_at
  );

  sessions.set(
    "missing-user-session",
    {
      id:
        "missing-user-session",
      user_id:
        "deleted-user",
      revoked_at: null,
      last_seen_at: null,
    }
  );

  result =
    await invoke({
      userId:
        "deleted-user",

      sessionId:
        "missing-user-session",
    });

  assert.strictEqual(
    result.statusCode,
    401
  );

  assert.strictEqual(
    result.nextCalled,
    false
  );

  assert.ok(
    sessions.get(
      "missing-user-session"
    ).revoked_at
  );

  result =
    await invoke({
      userId:
        "active-user",

      sessionId:
        "missing-session",
    });

  assert.strictEqual(
    result.statusCode,
    401
  );

  assert.strictEqual(
    result.nextCalled,
    false
  );

  console.log(
    "AUTH ACTIVE STATUS SELF-TEST: OK"
  );
}

main().catch((err) => {
  console.error(
    "AUTH ACTIVE STATUS SELF-TEST FAILED:",
    err
  );

  process.exit(1);
});
