const express = require("express");

const router = express.Router();
const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");

function normalize(value) {
  return String(value || "").trim();
}

function mapRpcError(error) {
  const message = String(error?.message || "");

  if (
    message.includes("KYC_SUBMISSION_REQUIRED_FIELDS") ||
    message.includes("KYC_SUBMISSION_FIELD_TOO_LONG") ||
    message.includes("KYC_SUBMISSION_INVALID_DOB") ||
    message.includes("KYC_DOCUMENT_PATH_OWNERSHIP_INVALID")
  ) {
    return { status: 400, message: "Invalid KYC submission" };
  }

  if (message.includes("KYC_SUBMISSION_USER_NOT_ELIGIBLE")) {
    return { status: 403, message: "Account is not eligible for KYC submission" };
  }

  return { status: 500, message: "Failed to save KYC" };
}

router.post("/submit", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const fullName = normalize(req.body.fullName);
    const dob = normalize(req.body.dob);
    const address = normalize(req.body.address);
    const idPath = normalize(req.body.idPath);
    const selfiePath = normalize(req.body.selfiePath);

    if (!fullName || !dob || !address || !idPath || !selfiePath) {
      return res.status(400).json({
        message: "fullName, dob, address, idPath, selfiePath required",
      });
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "submit_kyc_v2",
      {
        p_user_id: userId,
        p_full_name: fullName,
        p_dob: dob,
        p_address: address,
        p_id_path: idPath,
        p_selfie_path: selfiePath,
      }
    );

    if (rpcError) {
      console.error("[kyc submit v2] RPC error:", rpcError);
      const mapped = mapRpcError(rpcError);
      return res.status(mapped.status).json({ message: mapped.message });
    }

    const payload = rpcData || {};

    if (payload.ok !== true) {
      const status =
        payload.code === "KYC_ALREADY_APPROVED" ||
        payload.code === "KYC_ALREADY_PENDING"
          ? 409
          : 400;

      return res.status(status).json({
        code: payload.code || "KYC_SUBMISSION_REJECTED",
        message: payload.message || "KYC submission rejected",
        status: payload.status || null,
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("kyc_profiles")
      .select(
        "user_id, fullName, dob, address, id_path, selfie_path, status, created_at, updated_at, reviewed_at, rejection_reason"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("[kyc submit v2] profile reload error:", profileError);
      return res.status(500).json({ message: "Failed to load saved KYC" });
    }

    return res.json({
      message: payload.event === "resubmitted" ? "KYC resubmitted" : "KYC submitted",
      kyc: profile,
    });
  } catch (error) {
    console.error("[kyc submit v2] crash:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
