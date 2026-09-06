"use strict";

const express = require("express");

const router =
  express.Router();

const authMiddleware =
  require(
    "../middlewares/auth.middleware"
  );

const {
  requireAdmin,
} = require(
  "../middlewares/admin.middleware"
);

const {
  adminMfaLimiter,
} = require(
  "../middlewares/rateLimit.middleware"
);

const {
  AdminMfaError,

  getAdminMfaStatus,
  startAdminMfaEnrollment,
  confirmAdminMfaEnrollment,
} = require(
  "../services/adminMfaEnrollment.service"
);

const {
  verifyAdminMfaForSession,
} = require(
  "../services/adminMfaAuth.service"
);

const {
  logAdminAction,
} = require(
  "../utils/auditLogger"
);

function sendMfaError(
  res,
  err
) {
  if (
    err instanceof
    AdminMfaError
  ) {
    return res
      .status(err.status)
      .json({
        message: err.message,
        code: err.code,
      });
  }

  console.error(
    "admin MFA route error:",
    err
  );

  return res
    .status(500)
    .json({
      message:
        "Internal server error",
    });
}

router.get(
  "/mfa/status",

  authMiddleware,
  requireAdmin,

  async (req, res) => {
    try {
      const status =
        await getAdminMfaStatus({
          userId:
            req.user.userId,

          sessionId:
            req.user.sessionId,
        });

      return res.json({
        mfa: status,
      });
    } catch (err) {
      return sendMfaError(
        res,
        err
      );
    }
  }
);

router.post(
  "/mfa/enroll/start",

  authMiddleware,
  requireAdmin,
  adminMfaLimiter,

  async (req, res) => {
    try {
      const result =
        await startAdminMfaEnrollment({
          userId:
            req.user.userId,

          sessionId:
            req.user.sessionId,

          password:
            req.body?.password,
        });

      await logAdminAction({
        adminId:
          req.adminUser.id,

        adminPhone:
          req.adminUser.phone,

        action:
          "ADMIN_MFA_ENROLLMENT_STARTED",

        targetType:
          "admin_mfa",

        targetId:
          req.adminUser.id,

        newValue: {
          status:
            "enrollment_started",
        },

        req,
      });

      return res.json({
        message:
          "MFA enrollment started",

        setup: result,
      });
    } catch (err) {
      return sendMfaError(
        res,
        err
      );
    }
  }
);

router.post(
  "/mfa/enroll/confirm",

  authMiddleware,
  requireAdmin,
  adminMfaLimiter,

  async (req, res) => {
    try {
      const result =
        await confirmAdminMfaEnrollment({
          userId:
            req.user.userId,

          sessionId:
            req.user.sessionId,

          token:
            req.body?.token,
        });

      await logAdminAction({
        adminId:
          req.adminUser.id,

        adminPhone:
          req.adminUser.phone,

        action:
          "ADMIN_MFA_ENABLED",

        targetType:
          "admin_mfa",

        targetId:
          req.adminUser.id,

        newValue: {
          enabled: true,
        },

        req,
      });

      return res.json({
        message:
          "MFA enabled successfully",

        ...result,
      });
    } catch (err) {
      return sendMfaError(
        res,
        err
      );
    }
  }
);


router.post(
  "/mfa/verify",

  authMiddleware,
  requireAdmin,
  adminMfaLimiter,

  async (req, res) => {
    try {
      const result =
        await verifyAdminMfaForSession({
          userId:
            req.user.userId,

          sessionId:
            req.user.sessionId,

          token:
            req.body?.token,

          recoveryCode:
            req.body?.recoveryCode,

          requireUnverified:
            false,
        });

      await logAdminAction({
        adminId:
          req.adminUser.id,

        adminPhone:
          req.adminUser.phone,

        action:
          "ADMIN_MFA_SESSION_VERIFIED",

        targetType:
          "admin_mfa",

        targetId:
          req.adminUser.id,

        newValue: {
          verified: true,

          usedRecoveryCode:
            result.usedRecovery,
        },

        req,
      });

      return res.json({
        message:
          "MFA verification successful",

        verifiedAt:
          result.verifiedAt,

        usedRecoveryCode:
          result.usedRecovery,
      });
    } catch (err) {
      return sendMfaError(
        res,
        err
      );
    }
  }
);

module.exports = router;
