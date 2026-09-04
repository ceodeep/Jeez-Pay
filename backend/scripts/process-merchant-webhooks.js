#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const path = require("path");

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const envPath = argValue("--env");
if (envPath) {
  require("dotenv").config({ path: path.resolve(envPath), quiet: true });
} else {
  require("dotenv").config({ quiet: true });
}

const {
  processPendingMerchantWebhooks,
  resolvePublicWebhookDestination,
  signWebhookPayload,
  validateWebhookUrlSyntax,
} = require("../src/services/merchantWebhook.service");

async function selfTest() {
  const allowed = validateWebhookUrlSyntax("https://example.com/webhooks/jeezpay");
  if (allowed.protocol !== "https:" || allowed.hostname !== "example.com") {
    throw new Error("SELF_TEST_VALID_HTTPS_FAILED");
  }

  for (const invalid of [
    "http://example.com/hook",
    "https://localhost/hook",
    "https://merchant.local/hook",
    "https://user:pass@example.com/hook",
    "https://example.com:8443/hook",
  ]) {
    let blocked = false;
    try {
      validateWebhookUrlSyntax(invalid);
    } catch {
      blocked = true;
    }
    if (!blocked) {
      throw new Error(`SELF_TEST_UNSAFE_URL_ACCEPTED:${invalid}`);
    }
  }

  for (const privateUrl of [
    "https://127.0.0.1/hook",
    "https://10.0.0.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
  ]) {
    let blocked = false;
    try {
      await resolvePublicWebhookDestination(privateUrl);
    } catch {
      blocked = true;
    }
    if (!blocked) {
      throw new Error(`SELF_TEST_PRIVATE_ADDRESS_ACCEPTED:${privateUrl}`);
    }
  }

  const payloadString = JSON.stringify({ ok: true, amount: "1.00" });
  const secret = "phase7-self-test-secret";
  const timestamp = "1700000000";
  const actual = signWebhookPayload({ payloadString, secret, timestamp });
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payloadString}`)
    .digest("hex");

  if (actual !== expected || !/^[0-9a-f]{64}$/.test(actual)) {
    throw new Error("SELF_TEST_SIGNATURE_FAILED");
  }

  console.log("MERCHANT WEBHOOK WORKER SELF-TEST: OK");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

  const rawLimit = argValue("--limit") || "20";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100");
  }

  const results = await processPendingMerchantWebhooks(limit);
  const sent = results.filter((item) => item.status === "sent").length;
  const failed = results.filter((item) => item.status === "failed").length;

  console.log(
    JSON.stringify({
      ok: true,
      claimed: results.length,
      sent,
      failed,
      results,
    }),
  );
}

main().catch((error) => {
  console.error("MERCHANT WEBHOOK WORKER FAILED:", error?.stack || error);
  process.exitCode = 1;
});
