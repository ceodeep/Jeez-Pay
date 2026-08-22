const crypto = require("crypto");
const express = require("express");

const supabase = require("../config/supabase");
const {
  merchantAuthMiddleware,
} = require("../middlewares/merchantAuth.middleware");

const router = express.Router();

const LINK_APPROVAL_TTL_MS = 10 * 60 * 1000;

function cleanString(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function hashState(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function safeEqualHex(a, b) {
  const aBuffer = Buffer.from(String(a || ""), "utf8");
  const bBuffer = Buffer.from(String(b || ""), "utf8");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function validState(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 200 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function authorizeUrl(id) {
  return `jeezpay://account-link/${id}`;
}

function isExpired(row) {
  return (
    !row?.expires_at ||
    new Date(row.expires_at).getTime() <= Date.now()
  );
}

async function expireIfNecessary(row) {
  if (
    !row ||
    !["pending", "approved"].includes(row.status) ||
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
    .eq("status", row.status)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[merchant-account-links] expire error:", error);
    throw error;
  }

  return data || row;
}

/**
 * POST /merchant/account-links
 *
 * Body:
 * {
 *   client_reference: opaque Nile Live connection ID,
 *   state: high-entropy server-generated nonce,
 *   subject_hint?: optional text displayed during consent
 * }
 *
 * state is NEVER returned in the deep link and only its hash is persisted.
 */
router.post("/", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;

    const clientReference = cleanString(
      req.body.client_reference,
      120,
    );

    const state =
      typeof req.body.state === "string"
        ? req.body.state.trim()
        : "";

    const subjectHint =
      cleanString(req.body.subject_hint, 160) || null;

    if (!clientReference) {
      return res.status(400).json({
        code: "INVALID_CLIENT_REFERENCE",
        message: "client_reference is required",
      });
    }

    if (!validState(state)) {
      return res.status(400).json({
        code: "INVALID_STATE",
        message:
          "state must be a high-entropy URL-safe value between 32 and 200 characters",
      });
    }

    const stateHash = hashState(state);

    const { data: existingRaw, error: existingError } =
      await supabase
        .from("merchant_account_links")
        .select("*")
        .eq("merchant_id", String(merchant.id))
        .eq("client_reference", clientReference)
        .maybeSingle();

    if (existingError) {
      console.error(
        "[merchant-account-links] existing lookup error:",
        existingError,
      );

      return res.status(500).json({
        message: "Failed to create account connection request",
      });
    }

    if (existingRaw) {
      const existing = await expireIfNecessary(existingRaw);

      if (!safeEqualHex(existing.state_hash, stateHash)) {
        return res.status(409).json({
          code: "CLIENT_REFERENCE_CONFLICT",
          message:
            "client_reference has already been used with different authorization state",
        });
      }

      if (
        existing.status === "pending" ||
        existing.status === "approved"
      ) {
        return res.status(200).json({
          account_link: {
            id: existing.id,
            client_reference: existing.client_reference,
            status: existing.status,
            expires_at: existing.expires_at,
          },
          authorize_url: authorizeUrl(existing.id),
        });
      }

      return res.status(409).json({
        code: "CLIENT_REFERENCE_ALREADY_USED",
        message:
          "This client_reference has already completed or expired. Create a new connection request.",
      });
    }

    const expiresAt = new Date(
      Date.now() + LINK_APPROVAL_TTL_MS,
    ).toISOString();

    const { data: created, error: insertError } =
      await supabase
        .from("merchant_account_links")
        .insert({
          merchant_id: String(merchant.id),
          client_reference: clientReference,
          subject_hint: subjectHint,
          state_hash: stateHash,
          status: "pending",
          expires_at: expiresAt,
        })
        .select(
          [
            "id",
            "client_reference",
            "status",
            "expires_at",
          ].join(","),
        )
        .single();

    if (insertError) {
      console.error(
        "[merchant-account-links] insert error:",
        insertError,
      );

      return res.status(500).json({
        message: "Failed to create account connection request",
      });
    }

    return res.status(201).json({
      account_link: created,
      authorize_url: authorizeUrl(created.id),
    });
  } catch (err) {
    console.error(
      "[merchant-account-links] create crash:",
      err,
    );

    return res.status(500).json({
      message: "Failed to create account connection request",
    });
  }
});

/**
 * GET /merchant/account-links/:id
 *
 * Merchant may poll status, but verified JeezPay identity is not exposed
 * until the one-time exchange succeeds.
 */
router.get("/:id", merchantAuthMiddleware, async (req, res) => {
  try {
    const merchant = req.merchant;
    const id = cleanString(req.params.id, 80);

    const { data: raw, error } = await supabase
      .from("merchant_account_links")
      .select(
        [
          "id",
          "client_reference",
          "status",
          "expires_at",
          "approved_at",
          "cancelled_at",
          "consumed_at",
        ].join(","),
      )
      .eq("id", id)
      .eq("merchant_id", String(merchant.id))
      .maybeSingle();

    if (error) {
      console.error(
        "[merchant-account-links] status lookup error:",
        error,
      );

      return res.status(500).json({
        message: "Failed to fetch account connection request",
      });
    }

    if (!raw) {
      return res.status(404).json({
        code: "ACCOUNT_LINK_NOT_FOUND",
        message: "Account connection request not found",
      });
    }

    const row = await expireIfNecessary(raw);

    return res.json({
      account_link: {
        id: row.id,
        client_reference: row.client_reference,
        status: row.status,
        expires_at: row.expires_at,
        approved_at: row.approved_at,
        cancelled_at: row.cancelled_at,
        consumed_at: row.consumed_at,
      },
    });
  } catch (err) {
    console.error(
      "[merchant-account-links] status crash:",
      err,
    );

    return res.status(500).json({
      message: "Failed to fetch account connection request",
    });
  }
});

/**
 * POST /merchant/account-links/:id/cancel
 *
 * Merchant-only cancellation for an abandoned pending request.
 */
router.post(
  "/:id/cancel",
  merchantAuthMiddleware,
  async (req, res) => {
    try {
      const merchant = req.merchant;
      const id = cleanString(req.params.id, 80);

      const { data: raw, error: lookupError } =
        await supabase
          .from("merchant_account_links")
          .select("*")
          .eq("id", id)
          .eq("merchant_id", String(merchant.id))
          .maybeSingle();

      if (lookupError) {
        console.error(
          "[merchant-account-links] cancel lookup error:",
          lookupError,
        );

        return res.status(500).json({
          message:
            "Failed to cancel account connection request",
        });
      }

      if (!raw) {
        return res.status(404).json({
          code: "ACCOUNT_LINK_NOT_FOUND",
          message: "Account connection request not found",
        });
      }

      const row = await expireIfNecessary(raw);

      if (row.status === "cancelled") {
        return res.json({
          ok: true,
          account_link: {
            id: row.id,
            status: row.status,
            cancelled_at: row.cancelled_at,
          },
        });
      }

      if (row.status === "expired") {
        return res.status(410).json({
          code: "AUTHORIZATION_EXPIRED",
          message:
            "This account connection request has expired",
        });
      }

      if (row.status !== "pending") {
        return res.status(409).json({
          code: "AUTHORIZATION_NOT_PENDING",
          message:
            "Only a pending account connection request can be cancelled",
        });
      }

      const now = new Date().toISOString();

      const { data: cancelled, error: cancelError } =
        await supabase
          .from("merchant_account_links")
          .update({
            status: "cancelled",
            cancelled_at: now,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("merchant_id", String(merchant.id))
          .eq("status", "pending")
          .gt("expires_at", now)
          .select(
            [
              "id",
              "client_reference",
              "status",
              "cancelled_at",
            ].join(","),
          )
          .maybeSingle();

      if (cancelError) {
        console.error(
          "[merchant-account-links] cancel update error:",
          cancelError,
        );

        return res.status(500).json({
          message:
            "Failed to cancel account connection request",
        });
      }

      if (!cancelled) {
        return res.status(409).json({
          code: "AUTHORIZATION_NOT_PENDING",
          message:
            "This account connection request changed before it could be cancelled",
        });
      }

      return res.json({
        ok: true,
        account_link: cancelled,
      });
    } catch (err) {
      console.error(
        "[merchant-account-links] cancel crash:",
        err,
      );

      return res.status(500).json({
        message:
          "Failed to cancel account connection request",
      });
    }
  },
);

/**
 * POST /merchant/account-links/:id/exchange
 *
 * Body:
 * { state }
 *
 * Successful exchange is ONE-TIME.
 */
router.post(
  "/:id/exchange",
  merchantAuthMiddleware,
  async (req, res) => {
    try {
      const merchant = req.merchant;
      const id = cleanString(req.params.id, 80);

      const state =
        typeof req.body.state === "string"
          ? req.body.state.trim()
          : "";

      if (!validState(state)) {
        return res.status(400).json({
          code: "INVALID_STATE",
          message: "A valid authorization state is required",
        });
      }

      const { data: raw, error: lookupError } = await supabase
        .from("merchant_account_links")
        .select("*")
        .eq("id", id)
        .eq("merchant_id", String(merchant.id))
        .maybeSingle();

      if (lookupError) {
        console.error(
          "[merchant-account-links] exchange lookup error:",
          lookupError,
        );

        return res.status(500).json({
          message: "Failed to exchange account authorization",
        });
      }

      if (!raw) {
        return res.status(404).json({
          code: "ACCOUNT_LINK_NOT_FOUND",
          message: "Account connection request not found",
        });
      }

      const row = await expireIfNecessary(raw);

      if (!safeEqualHex(row.state_hash, hashState(state))) {
        return res.status(401).json({
          code: "INVALID_STATE",
          message: "Invalid account authorization state",
        });
      }

      if (row.status === "pending") {
        return res.status(409).json({
          code: "AUTHORIZATION_PENDING",
          message:
            "The JeezPay user has not approved this connection yet",
        });
      }

      if (row.status === "cancelled") {
        return res.status(409).json({
          code: "AUTHORIZATION_CANCELLED",
          message: "The JeezPay user cancelled this connection",
        });
      }

      if (row.status === "expired") {
        return res.status(410).json({
          code: "AUTHORIZATION_EXPIRED",
          message: "This account authorization has expired",
        });
      }

      if (row.status === "consumed" || row.consumed_at) {
        return res.status(409).json({
          code: "AUTHORIZATION_ALREADY_USED",
          message: "This account authorization has already been used",
        });
      }

      if (
        row.status !== "approved" ||
        !row.provider_user_id ||
        !row.wallet_account_number
      ) {
        return res.status(409).json({
          code: "AUTHORIZATION_NOT_APPROVED",
          message: "Account authorization is not approved",
        });
      }

      const now = new Date().toISOString();

      const { data: consumed, error: consumeError } =
        await supabase
          .from("merchant_account_links")
          .update({
            status: "consumed",
            consumed_at: now,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("merchant_id", String(merchant.id))
          .eq("status", "approved")
          .gt("expires_at", now)
          .is("consumed_at", null)
          .select(
            [
              "id",
              "client_reference",
              "provider_user_id",
              "wallet_account_number",
              "full_name",
              "approved_at",
              "consumed_at",
            ].join(","),
          )
          .maybeSingle();

      if (consumeError) {
        console.error(
          "[merchant-account-links] consume error:",
          consumeError,
        );

        return res.status(500).json({
          message: "Failed to exchange account authorization",
        });
      }

      if (!consumed) {
        return res.status(409).json({
          code: "AUTHORIZATION_ALREADY_USED",
          message:
            "This account authorization has already been consumed",
        });
      }

      return res.json({
        authorization: {
          request_id: consumed.id,
          client_reference: consumed.client_reference,

          provider_user_id: consumed.provider_user_id,

          wallet_account_number:
            consumed.wallet_account_number,

          full_name:
            consumed.full_name || "JeezPay User",

          approved_at: consumed.approved_at,
          consumed_at: consumed.consumed_at,
        },
      });
    } catch (err) {
      console.error(
        "[merchant-account-links] exchange crash:",
        err,
      );

      return res.status(500).json({
        message: "Failed to exchange account authorization",
      });
    }
  },
);

module.exports = router;
