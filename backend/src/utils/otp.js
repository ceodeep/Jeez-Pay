const crypto = require("crypto");

function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

module.exports = { generateOTP };
