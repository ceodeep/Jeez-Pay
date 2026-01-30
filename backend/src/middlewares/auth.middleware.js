const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) {
        return res.status(401).json({ message: "Missing token" });
    }
    const token = header.split(" ")[1];
    try{
        const decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
        next();
    } catch {
        res.status(401).json({ message: "Invalid token" });
    }
}

module.exports = authMiddleware;