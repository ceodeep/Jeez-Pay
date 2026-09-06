const supabase = require("../config/supabase");

function required(value, code) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new Error(code);
  }

  return normalized;
}

async function revokeUserSessions(
  userId,
  { exceptSessionId = null } = {}
) {
  const normalizedUserId = required(
    userId,
    "SESSION_USER_ID_REQUIRED"
  );

  const normalizedExceptSessionId = String(
    exceptSessionId || ""
  ).trim();

  let query = supabase
    .from("user_sessions")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("user_id", normalizedUserId)
    .is("revoked_at", null);

  if (normalizedExceptSessionId) {
    query = query.neq(
      "id",
      normalizedExceptSessionId
    );
  }

  const { error } = await query;

  if (error) {
    throw error;
  }
}

async function revokeCurrentSession(
  userId,
  sessionId
) {
  const normalizedUserId = required(
    userId,
    "SESSION_USER_ID_REQUIRED"
  );

  const normalizedSessionId = required(
    sessionId,
    "SESSION_ID_REQUIRED"
  );

  const { data, error } = await supabase
    .from("user_sessions")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("user_id", normalizedUserId)
    .eq("id", normalizedSessionId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return !!data;
}

module.exports = {
  revokeUserSessions,
  revokeCurrentSession,
};
