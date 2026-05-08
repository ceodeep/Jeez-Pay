const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const supabase = require("../config/supabase");

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, jwtSecret);

    if (!decoded.userId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    if (decoded.sessionId) {
      const { data: session, error } = await supabase
        .from("user_sessions")
        .select("id, revoked_at")
        .eq("id", decoded.sessionId)
        .eq("user_id", decoded.userId)
        .maybeSingle();

      if (error) {
        console.error("[auth] session lookup error:", error);
        return res.status(500).json({ message: "Session check failed" });
      }

      if (!session || session.revoked_at) {
        return res.status(401).json({
          message: "Session expired. Please login again.",
        });
      }

      await supabase
        .from("user_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", decoded.sessionId);
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
}

module.exports = authMiddleware;