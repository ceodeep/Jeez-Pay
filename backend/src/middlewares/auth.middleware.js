const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const supabase = require("../config/supabase");

const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const lastSeenUpdateCache = new Map();

function shouldUpdateLastSeen(sessionId) {
  const now = Date.now();
  const lastUpdate = lastSeenUpdateCache.get(sessionId) || 0;

  if (now - lastUpdate < LAST_SEEN_UPDATE_INTERVAL_MS) {
    return false;
  }

  lastSeenUpdateCache.set(sessionId, now);
  return true;
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtSecret);

    if (!decoded.userId) {
      return res.status(401).json({
        message: "Invalid token payload",
      });
    }

    const sessionId = String(
      decoded.sessionId || ""
    ).trim();

    // Every authenticated user token must be bound to a server-side
    // revocable session. Legacy/non-trackable JWTs fail closed.
    if (!sessionId) {
      return res.status(401).json({
        message: "Session expired. Please login again.",
      });
    }

    const { data: session, error } = await supabase
      .from("user_sessions")
      .select("id, revoked_at")
      .eq("id", sessionId)
      .eq("user_id", decoded.userId)
      .maybeSingle();

    if (error) {
      console.error("[auth] session lookup error:", error);

      return res.status(500).json({
        message: "Session check failed",
      });
    }

    if (!session || session.revoked_at) {
      return res.status(401).json({
        message: "Session expired. Please login again.",
      });
    }

    if (shouldUpdateLastSeen(sessionId)) {
      supabase
        .from("user_sessions")
        .update({
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .then(({ error: updateErr }) => {
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
    console.error("JWT error:", err.message);

    return res.status(401).json({
      message: "Invalid token",
    });
  }
}

module.exports = authMiddleware;
