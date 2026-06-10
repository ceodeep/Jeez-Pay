const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const bcrypt = require("bcrypt");
const { requireAdmin, requirePermission } = require("../middlewares/admin.middleware");
const {
  createTronAccount,
  encryptPrivateKey,
  tronWeb,
  sendUsdtTrc20FromPrivateKey,
} = require("../services/tron.service");
const { scanUsdtDeposits } = require("../services/usdtDepositScanner.service");

// ---- helper: check admin ----
async function isAdmin(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;
  return data.role === "admin";
}

function escapeCsv(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function publicReference() {
  return Number(String(Date.now()).slice(-11));
}

function toCsv(headers, rows) {
  const headerLine = headers.map(escapeCsv).join(",");
  const bodyLines = rows.map((row) =>
    headers.map((key) => escapeCsv(row[key])).join(",")
  );
  return [headerLine, ...bodyLines].join("\n");
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
    .select("id, phone, role")
    .eq("phone", phone)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getUserByIdentifier(identifierRaw) {
  const raw = String(identifierRaw || "").trim();
  const digitsOnly = /^\d+$/.test(raw);

  // 1️⃣ Try phone exact
  let { data, error } = await supabase
    .from("users")
    .select("id, phone, role, wallet_account_number, fullName")
    .eq("phone", raw)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  // 2️⃣ Try normalized phone
  const phoneNorm = normalizePhoneSudan(raw);
  if (phoneNorm !== raw) {
    const r2 = await supabase
      .from("users")
      .select("id, phone, role, wallet_account_number, fullName")
      .eq("phone", phoneNorm)
      .maybeSingle();

    if (r2.error) throw r2.error;
    if (r2.data) return r2.data;
  }

  // 3️⃣ If numeric only, try wallet_account_number
  if (digitsOnly) {
    const acc = Number(raw);
    if (Number.isSafeInteger(acc)) {
      const r3 = await supabase
        .from("users")
        .select("id, phone, role, wallet_account_number, fullName")
        .eq("wallet_account_number", acc)
        .maybeSingle();

      if (r3.error) throw r3.error;
      if (r3.data) return r3.data;
    }
  }

  return null;
}

// ---- helper: normalize currency ----
function normalizeCurrency(cur) {
  return String(cur || "").trim().toUpperCase();
}

// ✅ helper: normalize phone (same logic as auth)
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

const DEFAULT_CURRENCIES = ["USDT", "SDG", "SSP", "EGP", "UGX"];

// ---- helper: ensure a wallet exists for user+currency ----
async function ensureWallet(userId, currency) {
  currency = normalizeCurrency(currency);

  const { data: wallet, error } = await supabase
    .from("wallets")
    .select("id, balance, currency")
    .eq("user_id", userId)
    .eq("currency", currency)
    .maybeSingle();

  if (error) return { wallet: null, error };
  if (wallet) return { wallet, error: null };

  const { data: created, error: createErr } = await supabase
    .from("wallets")
    .insert([{ user_id: userId, currency, balance: 0 }])
    .select("id, balance, currency")
    .single();

  if (createErr) return { wallet: null, error: createErr };
  return { wallet: created, error: null };
}

// ---- helper: KYC gate ----
async function requireKycApproved(userId) {
  const { data: kyc, error: kycErr } = await supabase
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (kycErr) throw kycErr;
  return !!kyc && kyc.status === "approved";
}

// ================= PIN HELPERS =================

async function getUserPinState(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updatePinFail(userId, attempts, lockedUntil) {
  const { error } = await supabase
    .from("users")
    .update({
      pin_failed_attempts: attempts,
      pin_locked_until: lockedUntil || null,
    })
    .eq("id", userId);

  if (error) throw error;
}

async function resetPinFail(userId) {
  const { error } = await supabase
    .from("users")
    .update({
      pin_failed_attempts: 0,
      pin_locked_until: null,
    })
    .eq("id", userId);

  if (error) throw error;
}

async function getCurrencySettings(currency) {
  const { data, error } = await supabase
    .from("currency_settings")
    .select(`
      currency,
      fee_percent,
      flat_fee,
      min_transfer,
      max_transfer,
      is_enabled
    `)
    .eq("currency", currency)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// ==============================================

/**
 * GET /wallet/balance
 * Returns all balances for the logged-in user
 * Response: { balances: [{currency, balance}] }
 */
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Optional: auto-seed missing currencies for existing users
    for (const cur of DEFAULT_CURRENCIES) {
      const { error } = await ensureWallet(userId, cur);
      if (error) {
        console.error("ensureWallet error:", error);
        return res.status(500).json({ message: "Failed to ensure wallets" });
      }
    }

    const { data, error } = await supabase
      .from("wallets")
      .select("currency, balance")
      .eq("user_id", userId)
      .order("currency", { ascending: true });

    if (error) {
      console.error("balance fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch balances" });
    }

    return res.json({ balances: data || [] });
  } catch (err) {
    console.error("balance crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /wallet/history?currency=USDT
 * Returns last 50 transactions for the selected currency wallet
 */
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currency = normalizeCurrency(req.query.currency || "USDT");

    const { wallet, error } = await ensureWallet(userId, currency);
    if (error) {
      console.error("history ensureWallet error:", error);
      return res.status(500).json({ message: "Wallet check failed" });
    }

    const { data: txs, error: txErr } = await supabase
  .from("transactions")
  .select("id, wallet_id, type, amount, description, reference, created_at")
  .eq("wallet_id", wallet.id)
  .order("created_at", { ascending: false })
  .limit(50);

    if (txErr) {
      console.error("history tx fetch error:", txErr);
      return res.status(500).json({ message: "Failed to fetch transactions" });
    }

    return res.json({
      currency,
      transactions: txs || [],
    });
  } catch (err) {
    console.error("history crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// =====================================
// SWAP PREVIEW
// POST /wallet/swap/preview
// Body: { fromCurrency, toCurrency, amount }
// =====================================
router.post("/swap/preview", authMiddleware, async (req, res) => {
  try {
    const fromCurrency = normalizeCurrency(req.body.fromCurrency);
    const toCurrency = normalizeCurrency(req.body.toCurrency);
    const amount = Number(req.body.amount);

    if (!fromCurrency || !toCurrency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: "fromCurrency, toCurrency, and valid amount are required",
      });
    }

    if (fromCurrency === toCurrency) {
      return res.status(400).json({
        message: "Choose two different currencies",
      });
    }

    if (toCurrency === "USDT" && fromCurrency !== "USDT") {
  return res.status(400).json({
    message: "Swapping into USDT is not supported",
  });
}

    const rateRow = await getExchangeRate(fromCurrency, toCurrency);

    if (!rateRow) {
      return res.status(400).json({
        message: "Swap pair is not supported",
      });
    }

    if (!rateRow.is_enabled) {
      return res.status(400).json({
        message: "This swap pair is currently disabled",
      });
    }

    if (rateRow.min_amount && amount < Number(rateRow.min_amount)) {
      return res.status(400).json({
        message: `Minimum swap amount is ${rateRow.min_amount} ${fromCurrency}`,
      });
    }

    if (rateRow.max_amount && amount > Number(rateRow.max_amount)) {
      return res.status(400).json({
        message: `Maximum swap amount is ${rateRow.max_amount} ${fromCurrency}`,
      });
    }

    const quote = calculateSwapQuote(rateRow, amount);

    return res.json({
      fromCurrency,
      toCurrency,
      amount,
      rate: quote.rate,
      fee: quote.fee,
      totalDebit: quote.totalDebit,
      receiveAmount: quote.receiveAmount,
    });
  } catch (err) {
    console.error("[swap preview] error:", err);
    return res.status(500).json({ message: "Failed to preview swap" });
  }
});

// =====================================
// SWAP CONFIRM
// POST /wallet/swap/confirm
// Body: { fromCurrency, toCurrency, amount, pin }
// =====================================
router.post("/swap/confirm", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const fromCurrency = normalizeCurrency(req.body.fromCurrency);
    const toCurrency = normalizeCurrency(req.body.toCurrency);
    const amount = Number(req.body.amount);
    const pin = String(req.body.pin || "").trim();

    if (!fromCurrency || !toCurrency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: "fromCurrency, toCurrency, and valid amount are required",
      });
    }

    if (fromCurrency === toCurrency) {
      return res.status(400).json({
        message: "Choose two different currencies",
      });
    }
    if (toCurrency === "USDT" && fromCurrency !== "USDT") {
  return res.status(400).json({
    message: "Swapping into USDT is not supported",
  });
}

    const okKyc = await requireKycApproved(userId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before swaps",
      });
    }

    if (!pin) {
      return res.status(400).json({
        code: "PIN_REQUIRED",
        message: "PIN is required",
      });
    }

    const pinState = await getUserPinState(userId);

    if (!pinState?.pin_hash) {
      return res.status(400).json({
        code: "PIN_NOT_SET",
        message: "PIN not set for this account",
      });
    }

    if (pinState.pin_locked_until) {
      const lockedUntil = new Date(pinState.pin_locked_until);
      if (lockedUntil > new Date()) {
        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many attempts. Try again later.",
        });
      }
    }

    const okPin = await bcrypt.compare(pin, pinState.pin_hash);

    if (!okPin) {
      const attempts = (pinState.pin_failed_attempts || 0) + 1;

      if (attempts >= 5) {
        const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await updatePinFail(userId, attempts, lockedUntil);

        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many wrong attempts. Locked for 5 minutes.",
        });
      }

      await updatePinFail(userId, attempts, null);

      return res.status(403).json({
        code: "PIN_INVALID",
        message: "Invalid PIN",
      });
    }

    await resetPinFail(userId);

    const rateRow = await getExchangeRate(fromCurrency, toCurrency);

    if (!rateRow) {
      return res.status(400).json({
        message: "Swap pair is not supported",
      });
    }

    if (!rateRow.is_enabled) {
      return res.status(400).json({
        message: "This swap pair is currently disabled",
      });
    }

    if (rateRow.min_amount && amount < Number(rateRow.min_amount)) {
      return res.status(400).json({
        message: `Minimum swap amount is ${rateRow.min_amount} ${fromCurrency}`,
      });
    }

    if (rateRow.max_amount && amount > Number(rateRow.max_amount)) {
      return res.status(400).json({
        message: `Maximum swap amount is ${rateRow.max_amount} ${fromCurrency}`,
      });
    }

    const quote = calculateSwapQuote(rateRow, amount);

    const { wallet: fromWallet, error: fromWalletErr } = await ensureWallet(
      userId,
      fromCurrency
    );

    if (fromWalletErr || !fromWallet) {
      console.error("[swap confirm] from wallet error:", fromWalletErr);
      return res.status(500).json({ message: "Source wallet check failed" });
    }

    const { wallet: toWallet, error: toWalletErr } = await ensureWallet(
      userId,
      toCurrency
    );

    if (toWalletErr || !toWallet) {
      console.error("[swap confirm] to wallet error:", toWalletErr);
      return res.status(500).json({ message: "Destination wallet check failed" });
    }

    const fromBalance = Number(fromWallet.balance || 0);

    if (fromBalance < quote.totalDebit) {
      return res.status(400).json({
        message: "Insufficient balance",
      });
    }

    const newFromBalance = fromBalance - quote.totalDebit;
    const newToBalance = Number(toWallet.balance || 0) + quote.receiveAmount;

    const reference = `SWP-${Date.now()}`;

    const { error: updateFromErr } = await supabase
      .from("wallets")
      .update({ balance: newFromBalance })
      .eq("id", fromWallet.id);

    if (updateFromErr) {
      console.error("[swap confirm] debit error:", updateFromErr);
      return res.status(500).json({ message: "Swap debit failed" });
    }

    const { error: updateToErr } = await supabase
      .from("wallets")
      .update({ balance: newToBalance })
      .eq("id", toWallet.id);

    if (updateToErr) {
      console.error("[swap confirm] credit error:", updateToErr);
      return res.status(500).json({ message: "Swap credit failed" });
    }

    await supabase.from("transactions").insert([
      {
        wallet_id: fromWallet.id,
        type: "swap_out",
        amount: quote.totalDebit,
        description: `Swapped ${amount} ${fromCurrency} to ${toCurrency}`,
        reference,
      },
      {
        wallet_id: toWallet.id,
        type: "swap_in",
        amount: quote.receiveAmount,
        description: `Received from ${fromCurrency} swap`,
        reference,
      },
    ]);

    return res.json({
      message: "Swap successful",
      reference,
      fromCurrency,
      toCurrency,
      amount,
      rate: quote.rate,
      fee: quote.fee,
      totalDebit: quote.totalDebit,
      receiveAmount: quote.receiveAmount,
      fromBalance: newFromBalance,
      toBalance: newToBalance,
    });
  } catch (err) {
    console.error("[swap confirm] error:", err);
    return res.status(500).json({ message: "Swap failed" });
  }
});

/**
 * POST /wallet/credit (ADMIN ONLY)
 * Body: { userId, currency, amount, description }
 */
router.post("/credit", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can credit wallets" });
    }

    const { userId, amount, description } = req.body;
    const currency = normalizeCurrency(req.body.currency || "USDT");

    if (!userId || amount == null) {
      return res.status(400).json({ message: "userId and amount required" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const { wallet, error } = await ensureWallet(userId, currency);
    if (error || !wallet) {
      console.error("credit ensureWallet error:", error);
      return res.status(404).json({ message: "Wallet not found" });
    }

    const newBalance = Number(wallet.balance) + numericAmount;

    const { error: txErr } = await supabase.from("transactions").insert({
      wallet_id: wallet.id,
      type: "credit",
      amount: numericAmount,
      description: description || "Admin top-up",
    });

    if (txErr) {
      console.error("credit tx error:", txErr);
      return res.status(500).json({ message: "Transaction failed" });
    }

    const { error: updateErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (updateErr) {
      console.error("credit update error:", updateErr);
      return res.status(500).json({ message: "Balance update failed" });
    }

    return res.json({
      message: "Wallet credited",
      userId,
      currency,
      newBalance,
    });
  } catch (err) {
    console.error("credit crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /wallet/recipient/resolve?identifier=...
 * Resolves receiver by phone, normalized phone, or wallet account number
 */
router.get("/recipient/resolve", authMiddleware, async (req, res) => {
  try {
    const senderId = req.user.userId;
    const identifier = String(req.query.identifier || "").trim();

    if (!identifier) {
      return res.status(400).json({ message: "Receiver is required" });
    }

    const receiverUser = await getUserByIdentifier(identifier);

    if (!receiverUser) {
      return res.status(404).json({ message: "Receiver not found" });
    }

    if (receiverUser.id === senderId) {
      return res.status(400).json({ message: "You can't send money to yourself" });
    }

    const { data: receiverActive, error: receiverActiveErr } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", receiverUser.id)
      .maybeSingle();

    if (receiverActiveErr) {
      console.error("resolve recipient receiver lookup error:", receiverActiveErr);
      return res.status(500).json({ message: "Receiver lookup failed" });
    }

    if (!receiverActive || receiverActive.is_active === false) {
      return res.status(400).json({ message: "Receiver account is suspended" });
    }

    const { data: kycProfile, error: kycNameErr } = await supabase
      .from("kyc_profiles")
      .select("fullName, full_name")
      .eq("user_id", receiverUser.id)
      .maybeSingle();

    if (kycNameErr) {
      console.error("resolve recipient kyc name error:", kycNameErr);
    }

    const receiverName =
      receiverUser.fullName ||
      kycProfile?.fullName ||
      kycProfile?.full_name ||
      "JeezPay User";

    return res.json({
      receiver: {
        id: receiverUser.id,
        fullName: receiverName,
        phone: receiverUser.phone,
        walletAccountNumber: receiverUser.wallet_account_number,
      },
    });
  } catch (err) {
    console.error("resolve recipient error:", err);
    return res.status(500).json({ message: "Failed to resolve receiver" });
  }
});

/**
 * POST /wallet/transfer
 * Body: { phone, currency, amount, description }
 * USER -> USER transfer (KYC gated)
 */
router.post("/transfer", authMiddleware, async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { data: senderUser, error: senderErr } = await supabase
  .from("users")
  .select("is_active")
  .eq("id", senderId)
  .maybeSingle();

if (senderErr) {
  console.error("transfer sender lookup error:", senderErr);
  return res.status(500).json({ message: "Sender lookup failed" });
}

if (!senderUser || senderUser.is_active === false) {
  return res.status(403).json({ message: "Account is suspended" });
}
    console.log("[transfer] senderId:", senderId);

    const okKyc = await requireKycApproved(senderId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before transfers",
      });
    }

    // ✅ PIN check
    const pin = String(req.body.pin || "").trim();
    if (!pin) {
      return res.status(400).json({ code: "PIN_REQUIRED", message: "PIN is required" });
    }

    const pinState = await getUserPinState(senderId);
    if (!pinState?.pin_hash) {
      return res.status(400).json({ code: "PIN_NOT_SET", message: "PIN not set for this account" });
    }

    // lockout
    if (pinState.pin_locked_until) {
      const lockedUntil = new Date(pinState.pin_locked_until);
      if (lockedUntil > new Date()) {
        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many attempts. Try again later.",
        });
      }
    }

    const okPin = await bcrypt.compare(pin, pinState.pin_hash);

    if (!okPin) {
      const attempts = (pinState.pin_failed_attempts || 0) + 1;

      // lock after 5 wrong tries for 5 minutes
      if (attempts >= 5) {
        const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await updatePinFail(senderId, attempts, lockedUntil);
        return res.status(403).json({
          code: "PIN_LOCKED",
          message: "Too many wrong attempts. Locked for 5 minutes.",
        });
      } else {
        await updatePinFail(senderId, attempts, null);
        return res.status(403).json({
          code: "PIN_INVALID",
          message: "Invalid PIN",
        });
      }
    }

    // ✅ PIN correct: reset counters
    await resetPinFail(senderId);

    // ===== your existing transfer logic =====
    const phoneRaw = String(req.body.phone || "").trim();
    const amountRaw = req.body.amount;
    const currency = normalizeCurrency(req.body.currency);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || amountRaw == null || !currency) {
      return res.status(400).json({ message: "phone, amount, currency required" });
    }

    const phoneNorm = normalizePhoneSudan(phoneRaw);

   const amount = Number(amountRaw);
if (!Number.isFinite(amount) || amount <= 0) {
  return res.status(400).json({ message: "Invalid amount" });
}

// ✅ GET CURRENCY SETTINGS
const settings = await getCurrencySettings(currency);

if (!settings) {
  return res.status(400).json({ message: "Currency not supported" });
}

// ❌ Disabled currency
if (!settings.is_enabled) {
  return res.status(400).json({ message: "This currency is currently disabled" });
}

// ❌ Below minimum
if (settings.min_transfer && amount < settings.min_transfer) {
  return res.status(400).json({
    message: `Minimum transfer is ${settings.min_transfer} ${currency}`,
  });
}

// ❌ Above maximum
if (settings.max_transfer && amount > settings.max_transfer) {
  return res.status(400).json({
    message: `Maximum transfer is ${settings.max_transfer} ${currency}`,
  });
}

// ✅ CALCULATE FEE
const percentFee = (amount * Number(settings.fee_percent || 0)) / 100;
const flatFee = Number(settings.flat_fee || 0);
const fee = percentFee + flatFee;

// total sender pays
const totalDebit = amount + fee;

    const receiverUser = await getUserByIdentifier(phoneRaw);
    if (!receiverUser) {
      return res.status(400).json({ message: "Receiver not found" });
    }

    const { data: receiverActive, error: receiverActiveErr } = await supabase
  .from("users")
  .select("is_active")
  .eq("id", receiverUser.id)
  .maybeSingle();

if (receiverActiveErr) {
  console.error("transfer receiver lookup error:", receiverActiveErr);
  return res.status(500).json({ message: "Receiver lookup failed" });
}

if (!receiverActive || receiverActive.is_active === false) {
  return res.status(400).json({ message: "Receiver account is suspended" });
}

    if (receiverUser.id === senderId) {
  return res.status(400).json({ message: "You can't send money to yourself" });
}
    
    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: senderId,
      p_receiver_phone: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Sent to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("RPC transfer error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Transfer failed" });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const payload = row?.wallet_transfer ?? row ?? {};

    return res.json({
      message: payload.message || "Transfer successful",
      currency: payload.currency || currency,
      amount: Number(amount),
fee: Number(fee),
totalDebited: Number(totalDebit),
      phone: payload.phone || phoneNorm,
      reference: payload.reference || null,
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return res.status(500).json({ message: "Transfer failed" });
  }
});
router.post("/transfer-quote", authMiddleware, async (req, res) => {
  try {
    const currency = String(req.body.currency || "").trim().toUpperCase();
    const amount = Number(req.body.amount || 0);

    if (!currency || !amount || amount <= 0) {
      return res.status(400).json({ message: "currency and valid amount are required" });
    }

    const settings = await getCurrencySettings(currency);

    if (!settings) {
      return res.status(400).json({ message: "Currency settings not found" });
    }

    if (!settings.is_enabled) {
      return res.status(400).json({ message: `${currency} transfers are disabled` });
    }

    if (settings.min_transfer && amount < Number(settings.min_transfer)) {
      return res.status(400).json({
        message: `Minimum transfer is ${settings.min_transfer} ${currency}`,
      });
    }

    if (settings.max_transfer && amount > Number(settings.max_transfer)) {
      return res.status(400).json({
        message: `Maximum transfer is ${settings.max_transfer} ${currency}`,
      });
    }

    const percentFee = (amount * Number(settings.fee_percent || 0)) / 100;
    const flatFee = Number(settings.flat_fee || 0);
    const fee = percentFee + flatFee;
    const totalDebit = amount + fee;

    return res.json({
      currency,
      amount,
      fee,
      totalDebit,
      feePercent: Number(settings.fee_percent || 0),
      flatFee,
      minTransfer: Number(settings.min_transfer || 0),
      maxTransfer: Number(settings.max_transfer || 0),
      isEnabled: Boolean(settings.is_enabled),
    });
  } catch (err) {
    console.error("transfer-quote crash:", err);
    return res.status(500).json({ message: "Failed to calculate transfer quote" });
  }
});

/**
 * POST /wallet/agent-cash-in  (AGENT -> USER)
 * Body: { phone, currency, amount, description, fee }
 */
router.post("/agent-cash-in", authMiddleware, async (req, res) => {
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
    const fee = Number(req.body.fee ?? 0);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || !currency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "phone, currency, amount required" });
    }
    if (!Number.isFinite(fee) || fee < 0) {
      return res.status(400).json({ message: "Invalid fee" });
    }

    let customer = await getUserByPhone(phoneRaw);
    if (!customer) customer = await getUserByPhone(phoneNorm);

    if (!customer) return res.status(400).json({ message: "Customer not found" });
    if (customer.id === agentId) return res.status(400).json({ message: "You can't cash-in yourself" });
    if (customer.role !== "user") return res.status(400).json({ message: "Customer must be a user" });

    // Transfer money AGENT -> USER (agent must have balance/float)
    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: agentId,
      p_receiver_phone: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Agent cash-in to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("agent-cash-in RPC error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Cash-in failed" });
    }

    // ledger record (non-blocking is okay, but we'll handle error)
    const { error: opErr } = await supabase.from("agent_operations").insert({
      type: "cash_in",
      agent_user_id: agentId,
      customer_user_id: customer.id,
      currency,
      amount,
      fee,
      description: description || `Cash-in`,
      status: "completed",
    });

    if (opErr) {
      console.error("agent_operations insert error:", opErr);
      // Transfer succeeded; we still return success but warn in logs
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    return res.json({
      message: "Cash-in successful",
      currency,
      amount,
      fee,
      agentUserId: agentId,
      customerUserId: customer.id,
      phone: phoneNorm,
      senderBalance: row?.sender_balance ?? row?.senderBalance ?? null,
      receiverBalance: row?.receiver_balance ?? row?.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("agent-cash-in error:", err);
    return res.status(500).json({ message: "Cash-in failed" });
  }
});

/**
 * POST /wallet/agent-cash-out  (USER -> AGENT)
 * Body: { phone, currency, amount, description, fee }
 * KYC REQUIRED for the USER
 */
router.post("/agent-cash-out", authMiddleware, async (req, res) => {
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
    const fee = Number(req.body.fee ?? 0);
    const description = String(req.body.description || "").trim() || null;

    if (!phoneRaw || !currency || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "phone, currency, amount required" });
    }
    if (!Number.isFinite(fee) || fee < 0) {
      return res.status(400).json({ message: "Invalid fee" });
    }

    let agent = await getUserByPhone(phoneRaw);
    if (!agent) agent = await getUserByPhone(phoneNorm);

    if (!agent) return res.status(400).json({ message: "Agent not found" });
    if (agent.id === userId) return res.status(400).json({ message: "You can't cash-out to yourself" });
    if (agent.role !== "agent") return res.status(400).json({ message: "Receiver must be an agent" });

    // Transfer money USER -> AGENT
    const { data: rpcData, error: rpcErr } = await supabase.rpc("wallet_transfer", {
      p_sender_user_id: userId,
      p_receiver_phone: phoneRaw,
      p_currency: currency,
      p_amount: amount,
      p_description: description || `Agent cash-out to ${phoneNorm}`,
    });

    if (rpcErr) {
      console.error("agent-cash-out RPC error:", rpcErr);
      return res.status(400).json({ message: rpcErr.message || "Cash-out failed" });
    }

    const { error: opErr } = await supabase.from("agent_operations").insert({
      type: "cash_out",
      agent_user_id: agent.id,
      customer_user_id: userId,
      currency,
      amount,
      fee,
      description: description || `Cash-out`,
      status: "completed",
    });

    if (opErr) {
      console.error("agent_operations insert error:", opErr);
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    return res.json({
      message: "Cash-out successful",
      currency,
      amount,
      fee,
      agentUserId: agent.id,
      customerUserId: userId,
      phone: phoneNorm,
      senderBalance: row?.sender_balance ?? row?.senderBalance ?? null,
      receiverBalance: row?.receiver_balance ?? row?.receiverBalance ?? null,
    });
  } catch (err) {
    console.error("agent-cash-out error:", err);
    return res.status(500).json({ message: "Cash-out failed" });
  }
});

/**
 * GET /wallet/agent/operations
 * Agent can view their ledger
 */
router.get("/agent/operations", authMiddleware, async (req, res) => {
  try {
    const agentId = req.user.userId;

    const role = await getUserRole(agentId);
    if (role !== "agent") {
      return res.status(403).json({ message: "Only agents can view operations" });
    }

    const { data, error } = await supabase
      .from("agent_operations")
      .select("id, type, currency, amount, fee, description, status, created_at, customer_user_id")
      .eq("agent_user_id", agentId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("agent ops fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch agent operations" });
    }

    return res.json({ operations: data || [] });
  } catch (err) {
    console.error("agent ops crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});


// =====================================
// GET /admin/export/users.csv
// Optional query params:
// ?role=user
// ?search=+249...
// ?isActive=true
// ?phoneVerified=true
// ?accountType=personal
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// =====================================


// =====================================
// GET /admin/export/transactions.csv
// Optional query params:
// ?currency=USDT
// ?type=credit
// ?reference=ADM-...
// ?search=+249...
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// ?minAmount=10
// ?maxAmount=500
// =====================================


// =====================================
// GET /admin/export/kyc.csv
// Optional query params:
// ?status=pending
// ?search=+249...
// ?createdFrom=2026-01-01
// ?createdTo=2026-01-31
// =====================================


/**
 * POST /wallet/withdraw
 * User creates withdrawal request
 */
router.post("/withdraw", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, currency, method, destination } = req.body;

    if (!amount || !currency || !destination) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const { wallet } = await ensureWallet(userId, currency);

    if (!wallet || wallet.balance < numericAmount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // ❗ DO NOT deduct yet (admin will approve)
    const { error } = await supabase.from("withdraw_requests").insert({
      user_id: userId,
      wallet_id: wallet.id,
      amount: numericAmount,
      currency,
      method,
      destination,
      status: "pending",
    });

    if (error) {
      console.error("withdraw create error:", error);
      return res.status(500).json({ message: "Failed to create request" });
    }

    return res.json({ message: "Withdrawal request submitted" });
  } catch (err) {
    console.error("withdraw crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

async function getExchangeRate(fromCurrency, toCurrency) {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select(`
      from_currency,
      to_currency,
      rate,
      fee_percent,
      flat_fee,
      min_amount,
      max_amount,
      is_enabled
    `)
    .eq("from_currency", fromCurrency)
    .eq("to_currency", toCurrency)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function calculateSwapQuote(rateRow, amount) {
  const rate = Number(rateRow.rate || 0);
  const feePercent = Number(rateRow.fee_percent || 0);
  const flatFee = Number(rateRow.flat_fee || 0);

  const fee = (amount * feePercent) / 100 + flatFee;
  const totalDebit = amount + fee;
  const receiveAmount = amount * rate;

  return {
    rate,
    fee,
    totalDebit,
    receiveAmount,
  };
}
// =====================================
// CRYPTO DEPOSIT ADDRESS
// GET /wallet/crypto/deposit-address?token=USDT&network=TRON
// =====================================
router.get("/crypto/deposit-address", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const token = String(req.query.token || "USDT").trim().toUpperCase();
    const network = String(req.query.network || "TRON").trim().toUpperCase();

    if (token !== "USDT" || network !== "TRON") {
      return res.status(400).json({
        message: "Only USDT on TRON is supported right now",
      });
    }

    const { data: existing, error: existingErr } = await supabase
      .from("crypto_deposit_addresses")
      .select("address, network, token, created_at")
      .eq("user_id", userId)
      .eq("network", network)
      .eq("token", token)
      .maybeSingle();

    if (existingErr) {
      console.error("[deposit-address] lookup error:", existingErr);
      return res.status(500).json({ message: "Failed to load deposit address" });
    }

    if (existing) {
      return res.json({
        network,
        token,
        address: existing.address,
        createdAt: existing.created_at,
      });
    }

    const account = await createTronAccount();
    const encryptedPrivateKey = encryptPrivateKey(account.privateKey);

    const { data: created, error: createErr } = await supabase
      .from("crypto_deposit_addresses")
      .insert({
        user_id: userId,
        network,
        token,
        address: account.address,
        encrypted_private_key: encryptedPrivateKey,
      })
      .select("address, network, token, created_at")
      .single();

    if (createErr) {
      console.error("[deposit-address] create error:", createErr);
      return res.status(500).json({ message: "Failed to create deposit address" });
    }

    return res.json({
      network,
      token,
      address: created.address,
      createdAt: created.created_at,
    });
  } catch (err) {
    console.error("[deposit-address] crash:", err);
    return res.status(500).json({ message: "Failed to prepare deposit address" });
  }
});

// =====================================
// ADMIN: SCAN USDT TRC20 DEPOSITS
// POST /wallet/crypto/scan-deposits
// =====================================
router.post("/crypto/scan-deposits", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user.userId;

    const admin = await isAdmin(adminId);
    if (!admin) {
      return res.status(403).json({ message: "Only admin can scan deposits" });
    }

    const result = await scanUsdtDeposits();
    return res.json(result);
  } catch (err) {
    console.error("[scan-deposits] crash:", err);
    return res.status(500).json({ message: "Deposit scan failed" });
  }
});

// =====================================
// CRYPTO DEPOSIT HISTORY
// GET /wallet/crypto/deposits?token=USDT&network=TRON
// =====================================
router.get("/crypto/deposits", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const token = String(req.query.token || "USDT").trim().toUpperCase();
    const network = String(req.query.network || "TRON").trim().toUpperCase();

    if (token !== "USDT" || network !== "TRON") {
      return res.status(400).json({
        message: "Only USDT on TRON is supported right now",
      });
    }

    const { data, error } = await supabase
      .from("crypto_deposits")
      .select(`
        id,
        network,
        token,
        tx_hash,
        from_address,
        to_address,
        amount,
        confirmations,
        status,
        credited_at,
        created_at
      `)
      .eq("user_id", userId)
      .eq("network", network)
      .eq("token", token)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[crypto-deposits] fetch error:", error);
      return res.status(500).json({ message: "Failed to fetch deposits" });
    }

    return res.json({
      deposits: data || [],
    });
  } catch (err) {
    console.error("[crypto-deposits] crash:", err);
    return res.status(500).json({ message: "Failed to fetch deposits" });
  }
});

// =====================================
// USDT TRC20 WITHDRAWAL REQUEST
// POST /wallet/crypto/withdraw/request
// Body: { toAddress, amount, pin }
// =====================================
router.post("/crypto/withdraw", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (String(process.env.USDT_WITHDRAWAL_ENABLED || "false").toLowerCase() !== "true") {
      return res.status(400).json({ message: "USDT withdrawals are disabled" });
    }

    const toAddress = String(req.body.toAddress || "").trim();
    const amount = Number(req.body.amount || 0);
    const pin = String(req.body.pin || "").trim();

    const fee = Number(process.env.USDT_WITHDRAWAL_FEE || 1);
    const min = Number(process.env.USDT_WITHDRAWAL_MIN || 5);
    const totalDebit = amount + fee;

    if (!tronWeb.isAddress(toAddress)) {
      return res.status(400).json({ message: "Invalid TRON address" });
    }

    if (!Number.isFinite(amount) || amount < min) {
      return res.status(400).json({ message: `Minimum withdrawal is ${min} USDT` });
    }

    if (!pin) {
      return res.status(400).json({ code: "PIN_REQUIRED", message: "PIN is required" });
    }

    const okKyc = await requireKycApproved(userId);
    if (!okKyc) {
      return res.status(403).json({
        code: "KYC_REQUIRED",
        message: "KYC must be approved before withdrawals",
      });
    }

    const pinState = await getUserPinState(userId);
    const okPin = pinState?.pin_hash && await bcrypt.compare(pin, pinState.pin_hash);

    if (!okPin) {
      return res.status(403).json({ code: "PIN_INVALID", message: "Invalid PIN" });
    }

    await resetPinFail(userId);

    const treasuryPrivateKey = process.env.TRON_TREASURY_PRIVATE_KEY;

    if (!treasuryPrivateKey) {
      return res.status(500).json({ message: "Treasury wallet not configured" });
    }

    const { wallet, error: walletErr } = await ensureWallet(userId, "USDT");

    if (walletErr || !wallet) {
      return res.status(400).json({ message: "USDT wallet not found" });
    }

    const balance = Number(wallet.balance || 0);

    if (balance < totalDebit) {
      return res.status(400).json({ message: "Insufficient USDT balance" });
    }

    const reference = publicReference();

    const { data: withdrawal, error: withdrawalErr } = await supabase
      .from("crypto_withdrawals")
      .insert({
        user_id: userId,
        wallet_id: wallet.id,
        network: "TRON",
        token: "USDT",
        to_address: toAddress,
        amount,
        fee,
        total_debit: totalDebit,
        status: "processing",
        reference,
        submitted_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (withdrawalErr) {
      console.error("withdrawal insert error:", withdrawalErr);
      return res.status(500).json({ message: "Failed to create withdrawal" });
    }

    const { error: debitErr } = await supabase
      .from("wallets")
      .update({ balance: balance - totalDebit })
      .eq("id", wallet.id);

    if (debitErr) {
      console.error("withdrawal debit error:", debitErr);
      return res.status(500).json({ message: "Failed to debit wallet" });
    }

    try {
      const txHash = await sendUsdtTrc20FromPrivateKey({
        fromPrivateKey: treasuryPrivateKey,
        toAddress,
        amount,
      });

      await supabase.from("transactions").insert([
        {
          wallet_id: wallet.id,
          type: "debit",
          amount,
          description: "USDT withdrawal",
          reference,
        },
        {
          wallet_id: wallet.id,
          type: "debit",
          amount: fee,
          description: "USDT withdrawal fee",
          reference,
        },
      ]);

      await supabase
        .from("crypto_withdrawals")
        .update({
          status: "completed",
          tx_hash: txHash,
          completed_at: new Date().toISOString(),
        })
        .eq("id", withdrawal.id);

      return res.json({
        message: "USDT withdrawal completed",
        amount,
        fee,
        totalDebit,
        txHash,
        reference,
      });
    } catch (sendErr) {
      console.error("USDT withdrawal send error:", sendErr);

      await supabase
        .from("wallets")
        .update({ balance })
        .eq("id", wallet.id);

      await supabase
        .from("crypto_withdrawals")
        .update({
          status: "failed",
          error_message: sendErr.message || "Blockchain transfer failed",
          failed_at: new Date().toISOString(),
        })
        .eq("id", withdrawal.id);

      return res.status(500).json({
        message: sendErr.message || "USDT withdrawal failed",
      });
    }
  } catch (err) {
    console.error("crypto withdraw crash:", err);
    return res.status(500).json({ message: "Withdrawal failed" });
  }
});

// =====================================
// USDT TRC20 WITHDRAWAL HISTORY
// GET /wallet/crypto/withdrawals
// =====================================
router.get("/crypto/withdrawals", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data, error } = await supabase
      .from("crypto_withdrawals")
      .select(`
        id,
        network,
        token,
        to_address,
        amount,
        fee,
        total_debit,
        status,
        tx_hash,
        admin_note,
        requested_at,
        approved_at,
        rejected_at,
        completed_at
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[crypto withdrawals] fetch error:", error);
      return res.status(500).json({
        message: "Failed to fetch withdrawals",
      });
    }

    return res.json({
      withdrawals: data || [],
    });
  } catch (err) {
    console.error("[crypto withdrawals] crash:", err);
    return res.status(500).json({
      message: "Failed to fetch withdrawals",
    });
  }
});

module.exports = router;
