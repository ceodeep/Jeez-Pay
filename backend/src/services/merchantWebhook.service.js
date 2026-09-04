const crypto = require("crypto");
const dns = require("dns").promises;
const https = require("https");
const net = require("net");

const supabase = require("../config/supabase");

const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;
const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;
const MAX_ERROR_LENGTH = 1000;
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 21600];

const blockedNetworks = new net.BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
]) {
  blockedNetworks.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
]) {
  blockedNetworks.addSubnet(network, prefix, "ipv6");
}

function signWebhookPayload({ payloadString, secret, timestamp }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payloadString}`)
    .digest("hex");
}

function validateWebhookUrlSyntax(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value || value.length > 1000) {
    throw new Error("Webhook URL is missing or too long");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Webhook URL is invalid");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Webhook URL credentials are not allowed");
  }

  if (!parsed.hostname) {
    throw new Error("Webhook URL hostname is missing");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Webhook URL destination is not allowed");
  }

  if (parsed.port && parsed.port !== "443") {
    throw new Error("Webhook URL must use HTTPS port 443");
  }

  return parsed;
}

function isBlockedAddress(address, family) {
  if (family === 4) {
    return blockedNetworks.check(address, "ipv4");
  }

  if (family === 6) {
    return blockedNetworks.check(address, "ipv6");
  }

  return true;
}

async function resolvePublicWebhookDestination(rawUrl) {
  const parsed = validateWebhookUrlSyntax(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("Webhook hostname did not resolve");
  }

  for (const item of addresses) {
    if (!item?.address || isBlockedAddress(item.address, item.family)) {
      throw new Error("Webhook URL resolved to a non-public address");
    }
  }

  return {
    parsed,
    hostname,
    address: addresses[0].address,
    family: addresses[0].family,
  };
}

function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (options && options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

async function postSignedWebhook({ url, eventType, payloadString, signature, timestamp }) {
  const destination = await resolvePublicWebhookDestination(url);
  const bodyBytes = Buffer.byteLength(payloadString, "utf8");

  if (bodyBytes > MAX_WEBHOOK_PAYLOAD_BYTES) {
    throw new Error("Webhook payload exceeds 64KB");
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: destination.hostname,
        port: 443,
        path: `${destination.parsed.pathname}${destination.parsed.search}`,
        method: "POST",
        lookup: pinnedLookup(destination.address, destination.family),
        servername: net.isIP(destination.hostname)
          ? undefined
          : destination.hostname,
        agent: false,
        maxHeaderSize: 16 * 1024,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBytes,
          "User-Agent": "JeezPay-Webhooks/1.0",
          "X-JeezPay-Event": eventType,
          "X-JeezPay-Timestamp": timestamp,
          "X-JeezPay-Signature": `sha256=${signature}`,
        },
      },
      (response) => {
        let received = 0;
        let preview = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          received += Buffer.byteLength(chunk, "utf8");
          if (preview.length < 4096) {
            preview += chunk.slice(0, 4096 - preview.length);
          }
          if (received > MAX_WEBHOOK_RESPONSE_BYTES) {
            response.destroy(new Error("Webhook response exceeds 64KB"));
          }
        });

        response.on("end", () => {
          const status = Number(response.statusCode || 0);
          if (status < 200 || status >= 300) {
            reject(
              new Error(
                `Webhook failed with HTTP ${status}: ${preview.slice(0, 500)}`,
              ),
            );
            return;
          }

          resolve({ ok: true, status, body: preview.slice(0, 500) });
        });

        response.on("error", reject);
      },
    );

    request.setTimeout(WEBHOOK_TIMEOUT_MS, () => {
      request.destroy(new Error("Webhook request timed out"));
    });

    request.on("error", reject);
    request.end(payloadString);
  });
}

function normalizeRelation(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function sendMerchantWebhookEvent(event) {
  const payment = normalizeRelation(event.merchant_payments);
  const merchant = normalizeRelation(event.merchants);

  const callbackUrl = payment?.callback_url || merchant?.webhook_url;
  const webhookSecret = merchant?.webhook_secret;

  if (!callbackUrl) {
    throw new Error("No callback_url or merchant webhook_url configured");
  }

  if (!webhookSecret) {
    throw new Error("Merchant webhook_secret is missing");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = {
    event_id: event.id,
    event_type: event.event_type,
    created_at: event.created_at,
    ...(isPlainObject(event.payload) ? event.payload : {}),
  };
  const payloadString = JSON.stringify(payload);
  const signature = signWebhookPayload({
    payloadString,
    secret: webhookSecret,
    timestamp,
  });

  return postSignedWebhook({
    url: callbackUrl,
    eventType: event.event_type,
    payloadString,
    signature,
    timestamp,
  });
}

function retryAtIso(attempts) {
  const index = Math.min(
    Math.max(attempts - 1, 0),
    RETRY_DELAYS_SECONDS.length - 1,
  );
  return new Date(Date.now() + RETRY_DELAYS_SECONDS[index] * 1000).toISOString();
}

async function processPendingMerchantWebhooks(limit = 10) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const lockToken = crypto.randomUUID();

  const { data: claimedRows, error: claimError } = await supabase.rpc(
    "claim_merchant_webhook_events_v1",
    {
      p_limit: normalizedLimit,
      p_lock_token: lockToken,
    },
  );

  if (claimError) throw claimError;

  const claimedIds = (claimedRows || [])
    .map((row) => row?.event_id)
    .filter(Boolean);

  if (claimedIds.length === 0) return [];

  const { data: events, error } = await supabase
    .from("merchant_webhook_events")
    .select(`
      id,
      merchant_id,
      merchant_payment_id,
      event_type,
      payload,
      status,
      attempts,
      created_at,
      next_attempt_at,
      locked_at,
      lock_token,
      merchants (
        id,
        name,
        status,
        webhook_url,
        webhook_secret
      ),
      merchant_payments (
        id,
        callback_url,
        merchant_order_id,
        status
      )
    `)
    .in("id", claimedIds)
    .eq("lock_token", lockToken);

  if (error) throw error;

  const results = [];

  for (const event of events || []) {
    const attempts = Number(event.attempts || 0) + 1;

    try {
      const merchant = normalizeRelation(event.merchants);
      if (!merchant || merchant.status !== "active") {
        throw new Error("Merchant is not active");
      }

      const sendResult = await sendMerchantWebhookEvent(event);

      const { error: updateErr } = await supabase
        .from("merchant_webhook_events")
        .update({
          status: "sent",
          attempts,
          last_error: null,
          sent_at: new Date().toISOString(),
          locked_at: null,
          lock_token: null,
          next_attempt_at: new Date().toISOString(),
        })
        .eq("id", event.id)
        .eq("lock_token", lockToken);

      if (updateErr) throw updateErr;

      results.push({ event_id: event.id, status: "sent", result: sendResult });
    } catch (err) {
      const message = String(
        err?.message || err || "Webhook delivery failed",
      ).slice(0, MAX_ERROR_LENGTH);

      const { error: updateErr } = await supabase
        .from("merchant_webhook_events")
        .update({
          status: "failed",
          attempts,
          last_error: message,
          next_attempt_at: retryAtIso(attempts),
          locked_at: null,
          lock_token: null,
        })
        .eq("id", event.id)
        .eq("lock_token", lockToken);

      if (updateErr) throw updateErr;

      results.push({ event_id: event.id, status: "failed", error: message });
    }
  }

  return results;
}

module.exports = {
  processPendingMerchantWebhooks,
  resolvePublicWebhookDestination,
  sendMerchantWebhookEvent,
  signWebhookPayload,
  validateWebhookUrlSyntax,
};
