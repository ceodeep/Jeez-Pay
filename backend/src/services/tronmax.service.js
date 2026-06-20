const supabase = require("../config/supabase");

const TRONMAX_API_URL = process.env.TRONMAX_API_URL;
const TRONMAX_API_KEY = process.env.TRONMAX_API_KEY;

async function rentTronEnergy({ receiver, purpose, amount, duration }) {
  if (String(process.env.TRONMAX_ENABLED || "false").toLowerCase() !== "true") {
    return { skipped: true, reason: "TRONMAX_DISABLED" };
  }

  if (!TRONMAX_API_URL || !TRONMAX_API_KEY) {
    throw new Error("TronMax is not configured");
  }

  const resourceAmount = Number(amount || process.env.TRONMAX_DEFAULT_ENERGY || 65000);
  const rentDuration = duration || process.env.TRONMAX_DEFAULT_DURATION || "15m";

  const response = await fetch(`${TRONMAX_API_URL}/v1/order/Create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": TRONMAX_API_KEY,
    },
    body: JSON.stringify({
      type: "Fast",
      resourceType: "Energy",
      receiver: [receiver],
      resourceAmount,
      duration: rentDuration,
    }),
  });

  const json = await response.json();

  if (!response.ok || !json.success) {
    throw new Error(json?.message || "TronMax energy rental failed");
  }

  const order = json.data?.orders?.[0];

  await supabase.from("tronmax_orders").insert({
    purpose,
    receiver,
    order_id: order?.orderId || null,
    resource_type: order?.resourceType || "energy",
    resource_amount: order?.resourceAmount || resourceAmount,
    duration: rentDuration,
    paid_amount: order?.paidAmount || null,
    status: order?.status || null,
    raw_response: json,
  });

  return {
    skipped: false,
    orderId: order?.orderId,
    status: order?.status,
    paidAmount: order?.paidAmount,
    raw: json,
  };
}

module.exports = {
  rentTronEnergy,
};