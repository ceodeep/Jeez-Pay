const http = require("http");
const https = require("https");
const supabase = require("../config/supabase");

const TRONMAX_API_URL = process.env.TRONMAX_API_URL;
const TRONMAX_API_KEY = process.env.TRONMAX_API_KEY;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOrderFromResponse(json) {
  return json?.data?.orders?.[0] || json?.data || null;
}

function isCompletedOrder(order) {
  return (
    String(order?.status || "").toLowerCase() === "completed" &&
    Number(order?.filled || 0) >= 100
  );
}

/**
 * TronMax status endpoint is documented as:
 * GET /v1/order/status
 * with JSON body: { orderId }
 *
 * Native fetch/undici may reject GET requests with a body,
 * so we use http/https directly for this request.
 */
async function tronmaxGetWithJsonBody(path, body) {
  if (!TRONMAX_API_URL || !TRONMAX_API_KEY) {
    throw new Error("TronMax is not configured");
  }

  const url = new URL(`${TRONMAX_API_URL}${path}`);
  const payload = JSON.stringify(body || {});
  const client = url.protocol === "https:" ? https : http;

  const options = {
    method: "GET",
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "x-api-key": TRONMAX_API_KEY,
    },
  };

  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        let json;

        try {
          json = data ? JSON.parse(data) : {};
        } catch (err) {
          return reject(
            new Error(`TronMax returned invalid JSON: ${data || err.message}`)
          );
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(
              json?.message ||
                `TronMax status request failed: HTTP ${res.statusCode}`
            )
          );
        }

        resolve(json);
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function getTronMaxOrderStatus(orderId) {
  if (!orderId) {
    throw new Error("TronMax orderId is required");
  }

  const json = await tronmaxGetWithJsonBody("/v1/order/status", {
    orderId,
  });

  if (!json.success) {
    throw new Error(json?.message || "TronMax order status check failed");
  }

  const order = getOrderFromResponse(json);

  if (!order) {
    throw new Error("TronMax order status response is missing order data");
  }

  return {
    order,
    raw: json,
  };
}

async function waitForTronMaxOrderCompleted(orderId) {
  const maxAttempts = Number(process.env.TRONMAX_STATUS_MAX_ATTEMPTS || 30);
  const delayMs = Number(process.env.TRONMAX_STATUS_DELAY_MS || 5000);

  let lastOrder = null;
  let lastRaw = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { order, raw } = await getTronMaxOrderStatus(orderId);

    lastOrder = order;
    lastRaw = raw;

    const status = String(order?.status || "").toLowerCase();
    const filled = Number(order?.filled || 0);

    if (status === "cancelled") {
      throw new Error(`TronMax order cancelled: ${orderId}`);
    }

    if (status === "completed" && filled >= 100) {
      return {
        order,
        raw,
      };
    }

    await sleep(delayMs);
  }

  throw new Error(
    `TronMax order not completed in time: ${orderId}, last status=${lastOrder?.status || "unknown"}, filled=${lastOrder?.filled ?? "unknown"}`
  );
}

async function rentTronEnergy({ receiver, purpose, amount, duration }) {
  if (String(process.env.TRONMAX_ENABLED || "false").toLowerCase() !== "true") {
    return { skipped: true, reason: "TRONMAX_DISABLED" };
  }

  if (!TRONMAX_API_URL || !TRONMAX_API_KEY) {
    throw new Error("TronMax is not configured");
  }

  const resourceAmount = Number(
    amount || process.env.TRONMAX_DEFAULT_ENERGY || 65000
  );

  const rentDuration =
    duration || process.env.TRONMAX_DEFAULT_DURATION || "15m";

  const orderType = process.env.TRONMAX_ORDER_TYPE || "Manual";

  const requestBody = {
    type: orderType,
    resourceType: "Energy",
    receiver: [receiver],
    resourceAmount,
    duration: rentDuration,
  };

  if (String(orderType).toLowerCase() === "manual") {
    requestBody.price = Number(process.env.TRONMAX_MANUAL_PRICE || 35);
  }

  const createResponse = await fetch(`${TRONMAX_API_URL}/v1/order/Create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": TRONMAX_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  const createJson = await createResponse.json();

  if (!createResponse.ok || !createJson.success) {
    throw new Error(createJson?.message || "TronMax energy rental failed");
  }

  const createdOrder = getOrderFromResponse(createJson);

  if (!createdOrder?.orderId) {
    throw new Error("TronMax order creation response is missing orderId");
  }

  await supabase.from("tronmax_orders").insert({
    purpose,
    receiver,
    order_id: createdOrder.orderId,
    resource_type: createdOrder.resourceType || "energy",
    resource_amount: createdOrder.resourceAmount || resourceAmount,
    duration: rentDuration,
    paid_amount: createdOrder.paidAmount || null,
    status: createdOrder.status || null,
    raw_response: {
      request: {
        type: requestBody.type,
        resourceType: requestBody.resourceType,
        receiver: requestBody.receiver,
        resourceAmount: requestBody.resourceAmount,
        duration: requestBody.duration,
        price: requestBody.price || null,
      },
      create_response: createJson,
    },
  });

  const { order: completedOrder, raw: statusJson } =
    await waitForTronMaxOrderCompleted(createdOrder.orderId);

  await supabase
    .from("tronmax_orders")
    .update({
      paid_amount: completedOrder.paidAmount || null,
      status: completedOrder.status || null,
      raw_response: {
        request: {
          type: requestBody.type,
          resourceType: requestBody.resourceType,
          receiver: requestBody.receiver,
          resourceAmount: requestBody.resourceAmount,
          duration: requestBody.duration,
          price: requestBody.price || null,
        },
        create_response: createJson,
        final_status_response: statusJson,
      },
    })
    .eq("order_id", createdOrder.orderId);

  return {
    skipped: false,
    orderId: completedOrder.orderId,
    status: completedOrder.status,
    filled: completedOrder.filled,
    paidAmount: completedOrder.paidAmount,
    price: completedOrder.price,
    resourceAmount: completedOrder.resourceAmount,
    request: {
      type: requestBody.type,
      resourceType: requestBody.resourceType,
      resourceAmount: requestBody.resourceAmount,
      duration: requestBody.duration,
      price: requestBody.price || null,
    },
    raw: statusJson,
  };
}

module.exports = {
  rentTronEnergy,
  getTronMaxOrderStatus,
  waitForTronMaxOrderCompleted,
};