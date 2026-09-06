"use strict";

const bcrypt = require("bcrypt");
const supabase = require("../config/supabase");

const {
  generateTotpSecret,
  buildOtpAuthUri,
  encryptTotpSecret,
  decryptTotpSecret,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
} = require("./adminMfa.service");

const ADMIN_ROLES = new Set([
  "admin",
  "super_admin",
  "finance_admin",
  "kyc_officer",
  "support_agent",
  "auditor",
]);

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000;

class AdminMfaError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "AdminMfaError";
    this.status = status;
    this.code = code;
  }
}

function createAdminMfaEnrollmentService({
  client = supabase,
  bcryptLib = bcrypt,
  cryptoService = {
    generateTotpSecret,
    buildOtpAuthUri,
    encryptTotpSecret,
    decryptTotpSecret,
    verifyTotp,
    generateRecoveryCodes,
    hashRecoveryCode,
  },
  now = () => Date.now(),
} = {}) {
  async function getFactor(userId) {
    const { data, error } = await client
      .from("admin_mfa_factors_v1")
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

  async function verifyAdminUser(userId) {
    const { data, error } = await client
      .from("users")
      .select(
        "id,email,phone,password_hash,role,is_active"
      )
      .eq("id", userId)
      .maybeSingle();

    if (
      error ||
      !data ||
      data.is_active === false ||
      !ADMIN_ROLES.has(String(data.role || ""))
    ) {
      throw new AdminMfaError(
        403,
        "Admin access denied",
        "ADMIN_ACCESS_DENIED"
      );
    }

    return data;
  }

  async function getCurrentSession(userId, sessionId) {
    if (!sessionId) {
      throw new AdminMfaError(
        401,
        "Session expired",
        "SESSION_REQUIRED"
      );
    }

    const { data, error } = await client
      .from("user_sessions")
      .select(
        "id,user_id,revoked_at,admin_mfa_verified_at"
      )
      .eq("id", sessionId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error || !data) {
      throw new AdminMfaError(
        401,
        "Session expired",
        "SESSION_REQUIRED"
      );
    }

    return data;
  }

  function assertNotLocked(factor) {
    const lockedUntil = factor?.locked_until
      ? new Date(factor.locked_until).getTime()
      : 0;

    if (lockedUntil && lockedUntil > now()) {
      throw new AdminMfaError(
        429,
        "Too many invalid MFA attempts. Try again later.",
        "MFA_LOCKED"
      );
    }
  }

  async function registerFailure(factor) {
    const lockExpired =
      factor.locked_until &&
      new Date(factor.locked_until).getTime() <= now();

    const currentAttempts = lockExpired
      ? 0
      : Number(factor.failed_attempts || 0);

    const nextAttempts = currentAttempts + 1;

    const updates = {
      failed_attempts: nextAttempts,
      locked_until: null,
      updated_at: new Date(now()).toISOString(),
    };

    if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
      updates.locked_until = new Date(
        now() + LOCK_DURATION_MS
      ).toISOString();
    }

    const { error } = await client
      .from("admin_mfa_factors_v1")
      .update(updates)
      .eq("user_id", factor.user_id);

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
      "Invalid authenticator code",
      "INVALID_MFA_CODE"
    );
  }

  async function getStatus({
    userId,
    sessionId,
  }) {
    await verifyAdminUser(userId);

    const session = await getCurrentSession(
      userId,
      sessionId
    );

    const factor = await getFactor(userId);

    let recoveryCodesRemaining = 0;

    if (factor?.enabled_at) {
      const { data, error } = await client
        .from("admin_mfa_recovery_codes_v1")
        .select("id")
        .eq("user_id", userId)
        .is("used_at", null);

      if (error) {
        throw new AdminMfaError(
          500,
          "MFA status lookup failed",
          "MFA_STATUS_FAILED"
        );
      }

      recoveryCodesRemaining = Array.isArray(data)
        ? data.length
        : 0;
    }

    return {
      enrollmentStarted: !!factor,
      enabled: !!factor?.enabled_at,
      enabledAt: factor?.enabled_at || null,
      lastVerifiedAt:
        factor?.last_verified_at || null,
      lockedUntil: factor?.locked_until || null,
      sessionVerifiedAt:
        session.admin_mfa_verified_at || null,
      recoveryCodesRemaining,
    };
  }

  async function startEnrollment({
    userId,
    sessionId,
    password,
  }) {
    const normalizedPassword = String(password || "");

    if (!normalizedPassword) {
      throw new AdminMfaError(
        400,
        "Current password is required",
        "PASSWORD_REQUIRED"
      );
    }

    await getCurrentSession(userId, sessionId);

    const user = await verifyAdminUser(userId);

    if (!user.password_hash) {
      throw new AdminMfaError(
        400,
        "Password authentication is unavailable for this account",
        "PASSWORD_UNAVAILABLE"
      );
    }

    const passwordMatches = await bcryptLib.compare(
      normalizedPassword,
      user.password_hash
    );

    if (!passwordMatches) {
      throw new AdminMfaError(
        401,
        "Invalid credentials",
        "INVALID_CREDENTIALS"
      );
    }

    const existing = await getFactor(userId);

    if (existing?.enabled_at) {
      throw new AdminMfaError(
        409,
        "MFA is already enabled",
        "MFA_ALREADY_ENABLED"
      );
    }

    const secret = cryptoService.generateTotpSecret();

    const secretCiphertext =
      cryptoService.encryptTotpSecret(
        userId,
        secret
      );

    const { error: deleteErr } = await client
      .from("admin_mfa_recovery_codes_v1")
      .delete()
      .eq("user_id", userId);

    if (deleteErr) {
      throw new AdminMfaError(
        500,
        "Failed to prepare MFA enrollment",
        "MFA_PREPARE_FAILED"
      );
    }

    const { error: factorErr } = await client
      .from("admin_mfa_factors_v1")
      .upsert(
        {
          user_id: userId,
          secret_ciphertext: secretCiphertext,
          enabled_at: null,
          last_verified_at: null,
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date(now()).toISOString(),
        },
        {
          onConflict: "user_id",
        }
      );

    if (factorErr) {
      throw new AdminMfaError(
        500,
        "Failed to start MFA enrollment",
        "MFA_START_FAILED"
      );
    }

    const label =
      user.email ||
      user.phone ||
      user.id;

    return {
      secret,
      otpauthUri:
        cryptoService.buildOtpAuthUri({
          secret,
          label,
        }),
      issuer: "JeezPay Admin",
      accountLabel: label,
    };
  }

  async function confirmEnrollment({
    userId,
    sessionId,
    token,
  }) {
    const normalizedToken =
      String(token || "").trim();

    if (!/^\d{6}$/.test(normalizedToken)) {
      throw new AdminMfaError(
        400,
        "A valid 6-digit authenticator code is required",
        "INVALID_MFA_CODE_FORMAT"
      );
    }

    await verifyAdminUser(userId);

    await getCurrentSession(
      userId,
      sessionId
    );

    const factor = await getFactor(userId);

    if (!factor) {
      throw new AdminMfaError(
        409,
        "Start MFA enrollment first",
        "MFA_ENROLLMENT_NOT_STARTED"
      );
    }

    if (factor.enabled_at) {
      throw new AdminMfaError(
        409,
        "MFA is already enabled",
        "MFA_ALREADY_ENABLED"
      );
    }

    assertNotLocked(factor);

    let secret;

    try {
      secret =
        cryptoService.decryptTotpSecret(
          userId,
          factor.secret_ciphertext
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
      await registerFailure(factor);
    }

    const recoveryCodes =
      cryptoService.generateRecoveryCodes(10);

    const recoveryHashes =
      recoveryCodes.map(
        (code) =>
          cryptoService.hashRecoveryCode(
            userId,
            code
          )
      );

    /*
     * One database RPC performs all security-sensitive
     * finalization atomically:
     *
     * - installs the 10 recovery hashes
     * - enables the factor
     * - records last_verified_at
     * - revokes every other admin session
     * - marks this session MFA-verified
     */
    const { data, error } = await client.rpc(
      "finalize_admin_mfa_enrollment_v1",
      {
        p_user_id: userId,
        p_session_id: sessionId,
        p_recovery_code_hashes:
          recoveryHashes,
      }
    );

    if (error || !data) {
      throw new AdminMfaError(
        500,
        "Failed to finalize MFA enrollment",
        "MFA_FINALIZE_FAILED"
      );
    }

    return {
      enabled: true,
      enabledAt: data,
      recoveryCodes,
      recoveryCodesShownOnce: true,
    };
  }

  return {
    getStatus,
    startEnrollment,
    confirmEnrollment,
  };
}

const defaultService =
  createAdminMfaEnrollmentService();

module.exports = {
  ADMIN_ROLES,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  AdminMfaError,
  createAdminMfaEnrollmentService,

  getAdminMfaStatus:
    defaultService.getStatus,

  startAdminMfaEnrollment:
    defaultService.startEnrollment,

  confirmAdminMfaEnrollment:
    defaultService.confirmEnrollment,
};
