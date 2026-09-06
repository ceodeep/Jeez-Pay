"use strict";

const express =
  require("express");

const router =
  express.Router();

const {
  adminMfaLimiter,
} = require(
  "../middlewares/rateLimit.middleware"
);

const {
  AdminMfaError,
  verifyAdminMfaLoginChallenge,
  verifyAdminMfaForSession,
} = require(
  "../services/adminMfaAuth.service"
);

const {
  generateToken,
} = require(
  "../services/jwt.service"
);

const {
  sendNewLoginAlert,
} = require(
  "../services/email.service"
);

router.post(
  "/admin-mfa/verify-login",
  adminMfaLimiter,
  async (req, res) => {
    try {
      const challenge =
        verifyAdminMfaLoginChallenge(
          req.body
            ?.challengeToken
        );

      const result =
        await verifyAdminMfaForSession({
          userId:
            challenge.userId,

          sessionId:
            challenge.sessionId,

          token:
            req.body?.token,

          recoveryCode:
            req.body
              ?.recoveryCode,

          requireUnverified:
            true,
        });

      const token =
        generateToken({
          userId:
            result.user.id,

          phone:
            result.user.phone,

          email:
            result.user.email,

          sessionId:
            result.session.id,
        });

      if (
        result.user.email
      ) {
        sendNewLoginAlert(
          result.user.email,
          result.session
            .device_name ||
            "Admin dashboard",

          result.session
            .ip_address
        ).catch((err) => {
          console.error(
            "admin MFA login alert failed:",
            err
          );
        });
      }

      return res.json({
        message:
          "Authenticated",

        token,

        hasPin:
          !!result.user
            .pin_hash,

        isNewUser:
          false,

        mfaVerified:
          true,

        usedRecoveryCode:
          result
            .usedRecovery,
      });
    } catch (err) {
      if (
        err instanceof
        AdminMfaError
      ) {
        return res
          .status(err.status)
          .json({
            message:
              err.message,

            code:
              err.code,
          });
      }

      console.error(
        "admin MFA login verify error:",
        err
      );

      return res
        .status(500)
        .json({
          message:
            "Internal server error",
        });
    }
  }
);

module.exports = router;
