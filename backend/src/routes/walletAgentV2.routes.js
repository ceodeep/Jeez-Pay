const crypto = require("crypto");
const express = require("express");

const supabase = require("../config/supabase");

const router = express.Router();

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePhoneSudan(raw) {
  const p = String(raw || "").trim();
  const digits = p.replace(/\D/g, "");

  if (digits.startsWith("0") && digits.length >= 10) {
    return "+249" + digits.substring(1);
  }
  if (digits.startsWith("249")) {
    return "+249" + digits.substring(3);
  }
  if (p.startsWith("+") && digits.length >= 8) {
    return "+" + digits;
  }
  if (digits.length === 9) {
    return "+249" + digits;
  }
  return p;
}

async function getUserRole(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role || null;
}

async function getUserByPhone(phone) {
  const { data, error } = await supabase
    .from("users")
    .select("id, phone, role, phone_verified")
    .eq("phone", phone)
    .eq("phone_verified", true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function requireKycApproved(userId) {
  const { data: kyc, error } = await supabase
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return !!kyc && kyc.status === "approved";
}

function resolveIdempotencyKey(req) {
  const headerKey = String(req.get("X-Idempotency-Key") || "").trim();
  const bodyKey = String(
    req.body?.idempotencyKey || req.body?.idempotency_key || ""
  ).trim();

  const key = headerKey || bodyKey || crypto.randomUUID();
  return key.slice(0, 120);
}

function safeAgentRpcError(error, fallbackMessage) {
  const message = String(error?.message || "");

  if (message.includes("LEDGER_AGENT_IDEMPOTENCY_CONFLICT")) {
    return {
      status: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "This request key was already used for a different operation",
      },
    };
  }

  if (
    message.includes("Insufficient balance") ||
    message.includes("Invalid amount") ||
    message.includes("Currency is disabled or not configured") ||
    message.includes("Sender wallet not found") ||
    message.includes("Receiver wallet not found") ||
    message.includes("Company account not configured") ||
    message.includes("Company wallet not found")
  ) {
    const publicMessage = message.includes("Insufficient balance")
      ? "Insufficient balance"
      : message.includes("Currency is disabled or not configured")
        ? "Currency is disabled or not configured"
        : message.includes("Invalid amount")
          ? "Invalid amount"
          : fallbackMessage;

    return { status: 400, body: { message: publicMessage } };
  }

  if (
    message.includes("LEDGER_AGENT_CASH_IN_AGENT_NOT_ELIGIBLE") ||
    message.includes("LEDGER_AGENT_CASH_OUT_CUSTOMER_NOT_ELIGIBLE")
  ) {
    return { status: 403, body: { message: fallbackMessage } };
  }

  if (
    message.includes("LEDGER_AGENT_CASH_IN_CUSTOMER_NOT_ELIGIBLE") ||
    message.includes("LEDGER_AGENT_CASH_OUT_AGENT_NOT_ELIGIBLE") ||
    message.includes("LEDGER_AGENT_CASH_IN_SELF_TRANSFER") ||
    message.includes("LEDGER_AGENT_CASH_OUT_SELF_TRANSFER") ||
    message.includes("LEDGER_AGENT_CASH_IN_INVALID_ARGUMENTS") ||
    message.includes("LEDGER_AGENT_CASH_OUT_INVALID_ARGUMENTS")
  ) {
    return { status: 400, body: { message: fallbackMessage } };
  }

  return { status: 503, body: { message: `${fallbackMessage}. Please try again.` } };
}

/**
 * Phase 4.4C agent money cutover.
 *
 * Authentication + wallet product policy run in app.js before this router.
 * The existing request/response contract is preserved, but the client-supplied
 * fee is no longer used for accounting. The authoritative fee is returned by
 * the atomic Ledger v2 database primitive and stored in agent_operations there.
 */
router.post("/agent-cash-in", async (req, res) => {
  try {
    const agentId = req.user.userId;

    const agentRole = await getUserRole(agentId);
    if (agentRole !== "agent") {
      return res.status(403).json({ message: "Only agents can cash-in users" });
    }

    const phoneRaw = String(req.body.phone || "").trim();
    const phoneNorm = normalizePhoneSudan(phoneRaw);
    const currency = normalizeCurrency(req.body.currency);
    const amount = Number(req.body.amount);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || !currency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "phone, currency, amount required" });
    }

    let customer = await getUserByPhone(phoneRaw);
    if (!customer) customer = await getUserByPhone(phoneNorm);

    if (!customer) {
      return res.status(400).json({ message: "Customer not found" });
    }
    if (customer.id === agentId) {
      return res.status(400).json({ message: "You can't cash-in yourself" });
    }
    if (customer.role !== "user") {
      return res.status(400).json({ message: "Customer must be a user" });
    }

    const idempotencyKey = resolveIdempotencyKey(req);

    const { data, error } = await supabase.rpc("agent_cash_in_ledger_v2", {
      p_agent_user_id: agentId,
      p_customer_identifier: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Agent cash-in to ${phoneNorm}`,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error("[agent-cash-in-v2] rpc error:", {
        message: error.message,
        code: error.code,
      });
      const mapped = safeAgentRpcError(error, "Cash-in failed");
      return res.status(mapped.status).json(mapped.body);
    }

    const result = data || {};
    const actualFee = Number(result.fee ?? result.agentOperation?.fee ?? 0);

    return res.json({
      message: "Cash-in successful",
      currency,
      amount,
      fee: Number.isFinite(actualFee) ? actualFee : 0,
      agentUserId: agentId,
      customerUserId: result.customerUserId || customer.id,
      phone: phoneNorm,
      senderBalance: result.sender_balance ?? result.senderBalance ?? null,
      receiverBalance: result.receiver_balance ?? result.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("[agent-cash-in-v2] crash:", err);
    return res.status(500).json({ message: "Cash-in failed" });
  }
});

router.post("/agent-cash-out", async (req, res) => {
  try {
    const userId = req.user.userId;

    const userRole = await getUserRole(userId);
    if (userRole !== "user") {
      return res.status(403).json({ message: "Only users can cash-out" });
    }

    const okKyc = await requireKycApproved(userId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before cash-out",
      });
    }

    const phoneRaw = String(req.body.phone || "").trim();
    const phoneNorm = normalizePhoneSudan(phoneRaw);
    const currency = normalizeCurrency(req.body.currency);
    const amount = Number(req.body.amount);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || !currency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "phone, currency, amount required" });
    }

    let agent = await getUserByPhone(phoneRaw);
    if (!agent) agent = await getUserByPhone(phoneNorm);

    if (!agent) {
      return res.status(400).json({ message: "Agent not found" });
    }
    if (agent.id === userId) {
      return res.status(400).json({ message: "You can't cash-out to yourself" });
    }
    if (agent.role !== "agent") {
      return res.status(400).json({ message: "Receiver must be an agent" });
    }

    const idempotencyKey = resolveIdempotencyKey(req);

    const { data, error } = await supabase.rpc("agent_cash_out_ledger_v2", {
      p_customer_user_id: userId,
      p_agent_identifier: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Agent cash-out to ${phoneNorm}`,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error("[agent-cash-out-v2] rpc error:", {
        message: error.message,
        code: error.code,
      });
      const mapped = safeAgentRpcError(error, "Cash-out failed");
      return res.status(mapped.status).json(mapped.body);
    }

    const result = data || {};
    const actualFee = Number(result.fee ?? result.agentOperation?.fee ?? 0);

    return res.json({
      message: "Cash-out successful",
      currency,
      amount,
      fee: Number.isFinite(actualFee) ? actualFee : 0,
      agentUserId: result.agentUserId || agent.id,
      customerUserId: userId,
      phone: phoneNorm,
      senderBalance: result.sender_balance ?? result.senderBalance ?? null,
      receiverBalance: result.receiver_balance ?? result.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("[agent-cash-out-v2] crash:", err);
    return res.status(500).json({ message: "Cash-out failed" });
  }
});

module.exports = router;
