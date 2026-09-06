"use strict";

const {
  AdminMfaError,
  STEP_UP_MAX_AGE_MS,
  getAdminMfaAssurance,
} = require(
  "../services/adminMfaAuth.service"
);

const SAFE_METHODS =
  new Set([
    "GET",
    "HEAD",
    "OPTIONS",
  ]);

async function adminMfaAccessPolicy(
  req,
  res,
  next
) {
  /*
   * /admin/mfa/* is mounted before this middleware.
   *
   * Keep /admin/me/permissions available so an
   * unenrolled administrator can load the shell and
   * reach the MFA enrollment card, but do not expose
   * any other admin data until MFA is enrolled.
   */
  if (
    req.method === "GET" &&
    req.path ===
      "/me/permissions"
  ) {
    return next();
  }

  try {
    const assurance =
      await getAdminMfaAssurance({
        userId:
          req.user?.userId,

        sessionId:
          req.user?.sessionId,
      });

    if (!assurance.enabled) {
      return res
        .status(403)
        .json({
          message:
            "Admin MFA enrollment is required before accessing administrative data.",

          code:
            "ADMIN_MFA_ENROLLMENT_REQUIRED",
        });
    }

    if (
      SAFE_METHODS.has(
        req.method
      )
    ) {
      return next();
    }

    if (!assurance.fresh) {
      return res
        .status(403)
        .json({
          message:
            "Recent MFA verification is required. Verify MFA in the Admin security card and retry.",

          code:
            "ADMIN_MFA_STEP_UP_REQUIRED",

          maxAgeSeconds:
            Math.floor(
              STEP_UP_MAX_AGE_MS /
              1000
            ),

          verifiedAt:
            assurance
              .verifiedAt,
        });
    }

    return next();
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
      "admin MFA access policy error:",
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

module.exports = {
  adminMfaAccessPolicy,
};
