"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const supabase =
  require("../config/supabase");

const {
  jwtSecret,
} = require("../config/env");

const {
  decryptTotpSecret,
  verifyTotp,
  hashRecoveryCode,
} = require("./adminMfa.service");

const {
  ADMIN_ROLES,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  AdminMfaError,
} = require(
  "./adminMfaEnrollment.service"
);

const CHALLENGE_TTL_SECONDS = 5 * 60;
const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;

const CHALLENGE_AUDIENCE =
  "jeezpay-admin-mfa";

const CHALLENGE_ISSUER =
  "jeezpay-api";

function createAdminMfaAuthService({
  client = supabase,
  jwtLib = jwt,
  signingSecret = jwtSecret,
  cryptoService = {
    decryptTotpSecret,
    verifyTotp,
    hashRecoveryCode,
  },
  now = () => Date.now(),
  randomUUID = () =>
    crypto.randomUUID(),
} = {}) {
  function createLoginChallenge({
    userId,
    sessionId,
  }) {
    const normalizedUserId =
      String(userId || "").trim();

    const normalizedSessionId =
      String(sessionId || "").trim();

    if (
      !normalizedUserId ||
      !normalizedSessionId
    ) {
      throw new AdminMfaError(
        500,
        "Failed to create MFA challenge",
        "MFA_CHALLENGE_CREATE_FAILED"
      );
    }

    /*
     * Deliberately DO NOT use userId/sessionId claim names.
     * auth.middleware.js only accepts normal access tokens
     * containing both of those claims.
     *
     * Therefore this short-lived token cannot be used as a
     * bearer access token before MFA succeeds.
     */
    return jwtLib.sign(
      {
        purpose:
          "admin_mfa_login",
        sid:
          normalizedSessionId,
      },
      signingSecret,
      {
        subject:
          normalizedUserId,

        audience:
          CHALLENGE_AUDIENCE,

        issuer:
          CHALLENGE_ISSUER,

        expiresIn:
          CHALLENGE_TTL_SECONDS,

        jwtid:
          randomUUID(),
      }
    );
  }

  function verifyLoginChallenge(
    challengeToken
  ) {
    const normalized =
      String(
        challengeToken || ""
      ).trim();

    if (!normalized) {
      throw new AdminMfaError(
        400,
        "MFA challenge is required",
        "MFA_CHALLENGE_REQUIRED"
      );
    }

    let decoded;

    try {
      decoded =
        jwtLib.verify(
          normalized,
          signingSecret,
          {
            audience:
              CHALLENGE_AUDIENCE,

            issuer:
              CHALLENGE_ISSUER,
          }
        );
    } catch (_) {
      throw new AdminMfaError(
        401,
        "MFA challenge expired or invalid",
        "MFA_CHALLENGE_INVALID"
      );
    }

    if (
      decoded?.purpose !==
        "admin_mfa_login" ||
      !decoded?.sub ||
      !decoded?.sid
    ) {
      throw new AdminMfaError(
        401,
        "MFA challenge expired or invalid",
        "MFA_CHALLENGE_INVALID"
      );
    }

    return {
      userId:
        String(decoded.sub),

      sessionId:
        String(decoded.sid),
    };
  }

  async function getAdminUser(
    userId
  ) {
    const {
      data,
      error,
    } = await client
      .from("users")
      .select(
        [
          "id",
          "phone",
          "email",
          "pin_hash",
          "role",
          "is_active",
        ].join(",")
      )
      .eq("id", userId)
      .maybeSingle();

    if (
      error ||
      !data ||
      data.is_active === false ||
      !ADMIN_ROLES.has(
        String(data.role || "")
      )
    ) {
      throw new AdminMfaError(
        403,
        "Admin access denied",
        "ADMIN_ACCESS_DENIED"
      );
    }

    return data;
  }

  async function getFactor(
    userId
  ) {
    const {
      data,
      error,
    } = await client
      .from(
        "admin_mfa_factors_v1"
      )
      .select(
        [
          "user_id",
          "secret_ciphertext",
          "enabled_at",
          "last_verified_at",
          "failed_attempts",
          "locked_until",
        ].join(",")
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new AdminMfaError(
        500,
        "MFA lookup failed",
        "MFA_LOOKUP_FAILED"
      );
    }

    return data || null;
  }

  async function getEnabledFactor(
    userId
  ) {
    const factor =
      await getFactor(userId);

    if (!factor?.enabled_at) {
      return null;
    }

    return factor;
  }

  async function getSession(
    userId,
    sessionId
  ) {
    const {
      data,
      error,
    } = await client
      .from("user_sessions")
      .select(
        [
          "id",
          "user_id",
          "device_name",
          "app_platform",
          "ip_address",
          "user_agent",
          "revoked_at",
          "admin_mfa_verified_at",
        ].join(",")
      )
      .eq("id", sessionId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();

    if (
      error ||
      !data
    ) {
      throw new AdminMfaError(
        401,
        "Session expired",
        "SESSION_REQUIRED"
      );
    }

    return data;
  }

  function assertNotLocked(
    factor
  ) {
    const lockedUntil =
      factor?.locked_until
        ? new Date(
            factor.locked_until
          ).getTime()
        : 0;

    if (
      lockedUntil &&
      lockedUntil > now()
    ) {
      throw new AdminMfaError(
        429,
        "Too many invalid MFA attempts. Try again later.",
        "MFA_LOCKED"
      );
    }
  }

  async function registerFailure(
    factor
  ) {
    const lockExpired =
      factor.locked_until &&
      new Date(
        factor.locked_until
      ).getTime() <= now();

    const currentAttempts =
      lockExpired
        ? 0
        : Number(
            factor.failed_attempts ||
              0
          );

    const nextAttempts =
      currentAttempts + 1;

    const updates = {
      failed_attempts:
        nextAttempts,

      locked_until: null,

      updated_at:
        new Date(now())
          .toISOString(),
    };

    if (
      nextAttempts >=
      MAX_FAILED_ATTEMPTS
    ) {
      updates.locked_until =
        new Date(
          now() +
            LOCK_DURATION_MS
        ).toISOString();
    }

    const {
      error,
    } = await client
      .from(
        "admin_mfa_factors_v1"
      )
      .update(updates)
      .eq(
        "user_id",
        factor.user_id
      );

    if (error) {
      throw new AdminMfaError(
        500,
        "MFA verification failed",
        "MFA_UPDATE_FAILED"
      );
    }

    if (updates.locked_until) {
      throw new AdminMfaError(
        429,
        "Too many invalid MFA attempts. Try again later.",
        "MFA_LOCKED"
      );
    }

    throw new AdminMfaError(
      401,
      "Invalid MFA code",
      "INVALID_MFA_CODE"
    );
  }

  async function revokeUnverifiedSessions(
    userId
  ) {
    const {
      error,
    } = await client
      .from("user_sessions")
      .update({
        revoked_at:
          new Date(now())
            .toISOString(),
      })
      .eq("user_id", userId)
      .is("revoked_at", null)
      .is(
        "admin_mfa_verified_at",
        null
      );

    if (error) {
      throw new AdminMfaError(
        500,
        "Failed to prepare MFA login",
        "MFA_SESSION_CLEANUP_FAILED"
      );
    }
  }

  async function verifyForSession({
    userId,
    sessionId,
    token,
    recoveryCode,
    requireUnverified = false,
  }) {
    const user =
      await getAdminUser(userId);

    const factor =
      await getEnabledFactor(
        userId
      );

    if (!factor) {
      throw new AdminMfaError(
        403,
        "Admin MFA enrollment is required",
        "ADMIN_MFA_ENROLLMENT_REQUIRED"
      );
    }

    const session =
      await getSession(
        userId,
        sessionId
      );

    if (
      requireUnverified &&
      session
        .admin_mfa_verified_at
    ) {
      throw new AdminMfaError(
        409,
        "MFA challenge has already been used",
        "MFA_CHALLENGE_ALREADY_USED"
      );
    }

    assertNotLocked(factor);

    const normalizedToken =
      String(token || "")
        .trim();

    const normalizedRecovery =
      String(
        recoveryCode || ""
      ).trim();

    if (
      !!normalizedToken ===
      !!normalizedRecovery
    ) {
      throw new AdminMfaError(
        400,
        "Provide either an authenticator code or a recovery code",
        "MFA_CODE_REQUIRED"
      );
    }

    let recoveryHash = null;
    let usedRecovery = false;

    if (normalizedToken) {
      if (
        !/^\d{6}$/.test(
          normalizedToken
        )
      ) {
        throw new AdminMfaError(
          400,
          "A valid 6-digit authenticator code is required",
          "INVALID_MFA_CODE_FORMAT"
        );
      }

      let secret;

      try {
        secret =
          cryptoService
            .decryptTotpSecret(
              userId,
              factor
                .secret_ciphertext
            );
      } catch (_) {
        throw new AdminMfaError(
          500,
          "MFA secret could not be read",
          "MFA_SECRET_ERROR"
        );
      }

      const valid =
        cryptoService.verifyTotp(
          secret,
          normalizedToken,
          {
            timeMs: now(),
            window: 1,
          }
        );

      if (!valid) {
        await registerFailure(
          factor
        );
      }
    } else {
      try {
        recoveryHash =
          cryptoService
            .hashRecoveryCode(
              userId,
              normalizedRecovery
            );
      } catch (_) {
        throw new AdminMfaError(
          400,
          "Invalid recovery code format",
          "INVALID_RECOVERY_CODE_FORMAT"
        );
      }

      usedRecovery = true;
    }

    const {
      data,
      error,
    } = await client.rpc(
      "complete_admin_mfa_verification_v1",
      {
        p_user_id:
          userId,

        p_session_id:
          sessionId,

        p_recovery_code_hash:
          recoveryHash,

        p_require_unverified:
          !!requireUnverified,
      }
    );

    if (error) {
      if (
        requireUnverified &&
        String(
          error.message || ""
        ).includes(
          "MFA_CHALLENGE_ALREADY_USED"
        )
      ) {
        throw new AdminMfaError(
          409,
          "MFA challenge has already been used",
          "MFA_CHALLENGE_ALREADY_USED"
        );
      }

      throw new AdminMfaError(
        500,
        "MFA verification failed",
        "MFA_FINALIZE_FAILED"
      );
    }

    /*
     * A NULL scalar result means the supplied
     * recovery hash was not an unused code.
     */
    if (!data) {
      await registerFailure(
        factor
      );
    }

    return {
      verifiedAt:
        data,

      usedRecovery,

      user,

      session,
    };
  }

  async function getAssurance({
    userId,
    sessionId,
  }) {
    const factor =
      await getEnabledFactor(
        userId
      );

    if (!factor) {
      return {
        enabled: false,
        verifiedAt: null,
        fresh: false,
        ageMs: null,
      };
    }

    const session =
      await getSession(
        userId,
        sessionId
      );

    const timestamp =
      session
        .admin_mfa_verified_at;

    const verifiedMs =
      timestamp
        ? new Date(timestamp)
            .getTime()
        : NaN;

    const ageMs =
      Number.isFinite(
        verifiedMs
      )
        ? Math.max(
            0,
            now() -
              verifiedMs
          )
        : null;

    return {
      enabled: true,

      verifiedAt:
        timestamp || null,

      ageMs,

      fresh:
        ageMs !== null &&
        ageMs <=
          STEP_UP_MAX_AGE_MS,
    };
  }

  return {
    createLoginChallenge,
    verifyLoginChallenge,
    getEnabledFactor,
    revokeUnverifiedSessions,
    verifyForSession,
    getAssurance,
  };
}

const defaultService =
  createAdminMfaAuthService();

module.exports = {
  ADMIN_ROLES,
  CHALLENGE_TTL_SECONDS,
  STEP_UP_MAX_AGE_MS,

  AdminMfaError,

  createAdminMfaAuthService,

  createAdminMfaLoginChallenge:
    defaultService
      .createLoginChallenge,

  verifyAdminMfaLoginChallenge:
    defaultService
      .verifyLoginChallenge,

  getEnabledAdminMfaFactor:
    defaultService
      .getEnabledFactor,

  revokeUnverifiedAdminMfaSessions:
    defaultService
      .revokeUnverifiedSessions,

  verifyAdminMfaForSession:
    defaultService
      .verifyForSession,

  getAdminMfaAssurance:
    defaultService
      .getAssurance,
};
