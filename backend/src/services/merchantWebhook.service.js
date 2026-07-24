const crypto = require("crypto");
const supabase = require("../config/supabase");

function signWebhookPayload({ payloadString, secret, timestamp }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payloadString}`)
    .digest("hex");
}

async function sendMerchantWebhookEvent(event) {
  const payment = event.merchant_payments;
  const merchant = event.merchants;

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
    ...event.payload,
  };

  const payloadString = JSON.stringify(payload);

  const signature = signWebhookPayload({
    payloadString,
    secret: webhookSecret,
    timestamp,
  });

  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "JeezPay-Webhooks/1.0",
      "X-JeezPay-Event": event.event_type,
      "X-JeezPay-Timestamp": timestamp,
      "X-JeezPay-Signature": `sha256=${signature}`,
    },
    body: payloadString,
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Webhook failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  return {
    ok: true,
    status: response.status,
    body: responseText.slice(0, 500),
  };
}

async function processPendingMerchantWebhooks(limit = 10) {
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
      merchants (
        id,
        name,
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
    .in("status", ["pending", "failed"])
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  const results = [];

  for (const event of events || []) {
    try {
      const sendResult = await sendMerchantWebhookEvent(event);

      const { error: updateErr } = await supabase
        .from("merchant_webhook_events")
        .update({
          status: "sent",
          attempts: Number(event.attempts || 0) + 1,
          last_error: null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      if (updateErr) {
        throw updateErr;
      }

      results.push({
        event_id: event.id,
        status: "sent",
        result: sendResult,
      });
    } catch (err) {
      const attempts = Number(event.attempts || 0) + 1;

      await supabase
        .from("merchant_webhook_events")
        .update({
          status: "failed",
          attempts,
          last_error: err.message || String(err),
        })
        .eq("id", event.id);

      results.push({
        event_id: event.id,
        status: "failed",
        error: err.message || String(err),
      });
    }
  }

  return results;
}

module.exports = {
  processPendingMerchantWebhooks,
  sendMerchantWebhookEvent,
  signWebhookPayload,
};
