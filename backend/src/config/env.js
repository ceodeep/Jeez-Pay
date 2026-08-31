const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid TCP port number");
}

module.exports = {
  port,
  jwtSecret: requireEnv("JWT_SECRET"),
};
