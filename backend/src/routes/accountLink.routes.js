const bcrypt = require("bcrypt");
const express = require("express");

const supabase = require("../config/supabase");
const {
  pinVerifyLimiter,
} = require("../middlewares/rateLimit.middleware");

const router = express.Router();

const EXCHANGE_TTL_MS = 5 * 60 * 1000;

function cleanString(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function isExpired(row) {
  return (
    !row?.expires_at ||
    new Date(row.expires_at).getTime() <= Date.now()
  );
}

async function expirePendingIfNecessary(row) {
  if (
    !row ||
    row.status !== "pending" ||
    !isExpired(row)
  ) {
    return row;
  }

  const { data, error } = await supabase
    .from("merchant_account_links")
    .update({
      status: "expired",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[account-links] expire error:", error);
    throw error;
  }

  return data || row;
}

async function loadMerchant(merchantId) {
  const { data, error } = await supabase
    .from("merchants")
    .select("id, name, status")
    .eq("id", merchantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function verifyPinAndLoadUser(userId, pin) {
  if (!/^\d{4}$/.test(pin)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PIN",
      message: "PIN must be exactly 4 digits",
    };
  }

  const { data: user, error } = await supabase
    .from("users")
    .select(
      [
        "id",
        "fullName",
        "wallet_account_number",
        "is_active",
        "pin_hash",
        "pin_failed_attempts",
        "pin_locked_until",
      ].join(","),
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[account-links] user lookup error:", error);

    return {
      ok: false,
      status: 500,
      code: "USER_LOOKUP_FAILED",
      message: "User lookup failed",
    };
  }

  if (!user) {
    return {
      ok: false,
      status: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    };
  }

  if (user.is_active !== true) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_NOT_ELIGIBLE",
      message: "Your JeezPay account is not eligible for payouts",
    };
  }

  if (user.wallet_account_number == null) {
    return {
      ok: false,
      status: 400,
      code: "ACCOUNT_NUMBER_MISSING",
      message: "Your JeezPay wallet account number is unavailable",
    };
  }

  if (!user.pin_hash) {
    return {
      ok: false,
      status: 400,
      code: "PIN_NOT_SET",
      message: "No transaction PIN is set for this account",
    };
  }

  if (
    user.pin_locked_until &&
    new Date(user.pin_locked_until) > new Date()
  ) {
    return {
      ok: false,
      status: 423,
      code: "PIN_LOCKED",
      message:
        "PIN is temporarily locked. Please try again later.",
    };
  }

  const matches = await bcrypt.compare(pin, user.pin_hash);

  if (!matches) {
    const failedAttempts =
      Number(user.pin_failed_attempts || 0) + 1;

    const updates = {
      pin_failed_attempts: failedAttempts,
    };

    if (failedAttempts >= 5) {
      updates.pin_failed_attempts = 0;
      updates.pin_locked_until = new Date(
        Date.now() + 10 * 60 * 1000,
      ).toISOString();
    }

    const { error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId);

    if (updateError) {
      console.error(
        "[account-links] failed PIN counter update error:",
        updateError,
      );
    }

    return {
      ok: false,
      status: 400,
      code: "WRONG_PIN",
      message: "Wrong PIN",
    };
  }

  const { error: resetError } = await supabase
    .from("users")
    .update({
      pin_failed_attempts: 0,
      pin_locked_until: null,
    })
    .eq("id", userId);

  if (resetError) {
    console.error(
      "[account-links] PIN reset counter error:",
      resetError,
    );
  }

  return {
    ok: true,
    user,
  };
}

/**
 * GET /wallet/account-links/:id
 *
 * Returns consent-screen information.
 */
router.get("/:id", async (req, res) => {
  try {
    const id = cleanString(req.params.id, 80);

    const { data: raw, error } = await supabase
      .from("merchant_account_links")
      .select(
        [
          "id",
          "merchant_id",
          "client_reference",
          "subject_hint",
          "status",
          "expires_at",
          "approved_at",
          "cancelled_at",
        ].join(","),
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[account-links] lookup error:", error);

      return res.status(500).json({
        message: "Failed to load account connection request",
      });
    }

    if (!raw) {
      return res.status(404).json({
        code: "ACCOUNT_LINK_NOT_FOUND",
        message: "Account connection request not found",
      });
    }

    const row = await expirePendingIfNecessary(raw);

    const merchant = await loadMerchant(row.merchant_id);

    if (!merchant || merchant.status !== "active") {
      return res.status(400).json({
        code: "MERCHANT_NOT_AVAILABLE",
        message:
          "This merchant is not currently available for account connections",
      });
    }

    return res.json({
      account_link: {
        id: row.id,

        merchant: {
          id: String(merchant.id),
          name: merchant.name || "Merchant",
        },

        subject_hint: row.subject_hint,
        status: row.status,
        expires_at: row.expires_at,
        approved_at: row.approved_at,
        cancelled_at: row.cancelled_at,

        permissions: [
          "JeezPay account identity",
          "JeezPay payout account number",
          "Verified account holder name",
        ],
      },
    });
  } catch (err) {
    console.error("[account-links] details crash:", err);

    return res.status(500).json({
      message: "Failed to load account connection request",
    });
  }
});

/**
 * POST /wallet/account-links/:id/approve
 *
 * Body: { pin }
 *
 * Authentication comes from app.js.
 * PIN is independently verified against JeezPay backend storage here.
 */
router.post(
  "/:id/approve",
  pinVerifyLimiter,
  async (req, res) => {
    try {
      const id = cleanString(req.params.id, 80);
      const userId = req.user?.userId;

      const pin = String(req.body?.pin ?? "").trim();

      if (!userId) {
        return res.status(401).json({
          message: "Unauthorized",
        });
      }

      const { data: raw, error: lookupError } = await supabase
        .from("merchant_account_links")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (lookupError) {
        console.error(
          "[account-links] approval lookup error:",
          lookupError,
        );

        return res.status(500).json({
          message: "Failed to approve account connection",
        });
      }

      if (!raw) {
        return res.status(404).json({
          code: "ACCOUNT_LINK_NOT_FOUND",
          message: "Account connection request not found",
        });
      }

      const row = await expirePendingIfNecessary(raw);

      if (row.status === "expired") {
        return res.status(410).json({
          code: "AUTHORIZATION_EXPIRED",
          message: "This account connection request has expired",
        });
      }

      if (row.status === "cancelled") {
        return res.status(409).json({
          code: "AUTHORIZATION_CANCELLED",
          message:
            "This account connection request has been cancelled",
        });
      }

      if (row.status !== "pending") {
        return res.status(409).json({
          code: "AUTHORIZATION_NOT_PENDING",
          message:
            "This account connection request is no longer pending",
        });
      }

      const merchant = await loadMerchant(row.merchant_id);

      if (!merchant || merchant.status !== "active") {
        return res.status(400).json({
          code: "MERCHANT_NOT_AVAILABLE",
          message:
            "This merchant is not currently available for account connections",
        });
      }

      const pinResult = await verifyPinAndLoadUser(
        userId,
        pin,
      );

      if (!pinResult.ok) {
        return res.status(pinResult.status).json({
          ok: false,
          code: pinResult.code,
          message: pinResult.message,
        });
      }

      const user = pinResult.user;

      const { data: kyc, error: kycError } = await supabase
        .from("kyc_profiles")
        .select("fullName, status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (kycError) {
        console.error(
          "[account-links] KYC lookup error:",
          kycError,
        );

        return res.status(500).json({
          message: "Failed to verify JeezPay account",
        });
      }

      if (!kyc || kyc.status !== "approved") {
        return res.status(400).json({
          code: "KYC_REQUIRED",
          message:
            "Approved JeezPay KYC is required before connecting a payout account",
        });
      }

      const fullName =
        cleanString(kyc.fullName, 255) ||
        cleanString(user.fullName, 255) ||
        "JeezPay User";

      const now = new Date().toISOString();

      // Once the user approves, provide a short window for
      // Nile Live's backend to perform the one-time exchange.
      const exchangeExpiresAt = new Date(
        Date.now() + EXCHANGE_TTL_MS,
      ).toISOString();

      const { data: approved, error: updateError } =
        await supabase
          .from("merchant_account_links")
          .update({
            provider_user_id: String(user.id),

            wallet_account_number: String(
              user.wallet_account_number,
            ),

            full_name: fullName,

            status: "approved",
            approved_at: now,
            expires_at: exchangeExpiresAt,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("status", "pending")
          .gt("expires_at", now)
          .select(
            [
              "id",
              "status",
              "approved_at",
              "expires_at",
            ].join(","),
          )
          .maybeSingle();

      if (updateError) {
        console.error(
          "[account-links] approval update error:",
          updateError,
        );

        return res.status(500).json({
          message: "Failed to approve account connection",
        });
      }

      if (!approved) {
        return res.status(409).json({
          code: "AUTHORIZATION_NOT_PENDING",
          message:
            "This account connection request changed before it could be approved",
        });
      }

      return res.json({
        ok: true,

        account_link: {
          id: approved.id,
          status: approved.status,
          approved_at: approved.approved_at,
          expires_at: approved.expires_at,

          merchant: {
            id: String(merchant.id),
            name: merchant.name || "Merchant",
          },
        },
      });
    } catch (err) {
      console.error(
        "[account-links] approval crash:",
        err,
      );

      return res.status(500).json({
        message: "Failed to approve account connection",
      });
    }
  },
);

module.exports = router;
