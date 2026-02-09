const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const token = header.split(" ")[1];

    try {
        const decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
        next();
    } catch (err) {
        console.error("JWT error:", err.message);
        return res.status(401).json({ message: "Invalid token" });
    }
}

module.exports = authMiddleware;
