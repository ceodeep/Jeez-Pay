const jwt = require("jsonwebtoken");
const {
  jwtSecret,
} = require("../config/env");

const supabase =
  require("../config/supabase");

const LAST_SEEN_UPDATE_INTERVAL_MS =
  5 * 60 * 1000;

const lastSeenUpdateCache =
  new Map();

function shouldUpdateLastSeen(
  sessionId
) {
  const now = Date.now();

  const lastUpdate =
    lastSeenUpdateCache.get(
      sessionId
    ) || 0;

  if (
    now - lastUpdate <
    LAST_SEEN_UPDATE_INTERVAL_MS
  ) {
    return false;
  }

  lastSeenUpdateCache.set(
    sessionId,
    now
  );

  return true;
}

async function revokeSessionBestEffort(
  userId,
  sessionId
) {
  try {
    const { error } =
      await supabase
        .from("user_sessions")
        .update({
          revoked_at:
            new Date()
              .toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", userId)
        .is("revoked_at", null);

    if (error) {
      console.error(
        "[auth] session revoke error:",
        error
      );
    }
  } catch (err) {
    console.error(
      "[auth] session revoke crash:",
      err
    );
  }
}

async function authMiddleware(
  req,
  res,
  next
) {
  const header =
    req.headers.authorization;

  if (
    !header ||
    !header.startsWith(
      "Bearer "
    )
  ) {
    return res
      .status(401)
      .json({
        message:
          "Unauthorized",
      });
  }

  const token =
    header.split(" ")[1];

  try {
    const decoded =
      jwt.verify(
        token,
        jwtSecret
      );

    if (!decoded.userId) {
      return res
        .status(401)
        .json({
          message:
            "Invalid token payload",
        });
    }

    const sessionId =
      String(
        decoded.sessionId || ""
      ).trim();

    /*
     * Every normal access token must be
     * bound to a server-side revocable
     * session. MFA challenge tokens do not
     * contain these claims and therefore
     * continue to fail closed here.
     */
    if (!sessionId) {
      return res
        .status(401)
        .json({
          message:
            "Session expired. Please login again.",
        });
    }

    const {
      data: session,
      error: sessionError,
    } = await supabase
      .from("user_sessions")
      .select(
        "id, revoked_at"
      )
      .eq("id", sessionId)
      .eq(
        "user_id",
        decoded.userId
      )
      .maybeSingle();

    if (sessionError) {
      console.error(
        "[auth] session lookup error:",
        sessionError
      );

      return res
        .status(500)
        .json({
          message:
            "Session check failed",
        });
    }

    if (
      !session ||
      session.revoked_at
    ) {
      return res
        .status(401)
        .json({
          message:
            "Session expired. Please login again.",
        });
    }

    /*
     * Login already checks is_active, but that
     * is insufficient for a seven-day JWT.
     *
     * Re-check account status on every
     * authenticated request so suspension takes
     * effect immediately for existing sessions.
     */
    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select(
        "id, is_active"
      )
      .eq(
        "id",
        decoded.userId
      )
      .maybeSingle();

    if (userError) {
      console.error(
        "[auth] user status lookup error:",
        userError
      );

      return res
        .status(500)
        .json({
          message:
            "Account status check failed",
        });
    }

    if (!user) {
      await revokeSessionBestEffort(
        decoded.userId,
        sessionId
      );

      return res
        .status(401)
        .json({
          message:
            "Session expired. Please login again.",
        });
    }

    if (
      user.is_active === false
    ) {
      /*
       * Revoking the current tracked session makes
       * the suspension sticky even if a later
       * middleware/configuration regression occurs.
       */
      await revokeSessionBestEffort(
        decoded.userId,
        sessionId
      );

      return res
        .status(403)
        .json({
          message:
            "Account is suspended",
          code:
            "ACCOUNT_SUSPENDED",
        });
    }

    if (
      shouldUpdateLastSeen(
        sessionId
      )
    ) {
      supabase
        .from("user_sessions")
        .update({
          last_seen_at:
            new Date()
              .toISOString(),
        })
        .eq("id", sessionId)
        .then(({
          error: updateErr,
        }) => {
          if (updateErr) {
            console.error(
              "[auth] last_seen update error:",
              updateErr
            );
          }
        });
    }

    req.user = {
      ...decoded,
      sessionId,
    };

    next();
  } catch (err) {
    console.error(
      "JWT error:",
      err.message
    );

    return res
      .status(401)
      .json({
        message:
          "Invalid token",
      });
  }
}

module.exports =
  authMiddleware;
