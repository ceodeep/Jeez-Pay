const express = require("express");
const router = express.Router();

const supabase = require("../config/supabase");
const supabaseAdmin = require("../config/supabaseAdmin");
const authMiddleware = require("../middlewares/auth.middleware");

// Keep bucket private in Supabase dashboard
const KYC_BUCKET = "kyc-documents";

// small helpers
function safeType(t) {
  const x = String(t || "").toLowerCase();
  if (x !== "id" && x !== "selfie") return null;
  return x;
}

function safeContentType(ct) {
  const x = String(ct || "").toLowerCase();
  const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
  return allowed.includes(x) ? x : null;
}

function extFromContentType(ct) {
  if (ct === "image/png") return "png";
  if (ct === "application/pdf") return "pdf";
  return "jpg";
}

/**
 * POST /kyc/upload-url
 * body: { fileType: "id"|"selfie", contentType: "image/jpeg"|"image/png"|"application/pdf" }
 * returns: { path, signedUrl }
 */
router.post("/upload-url", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const fileType = safeType(req.body.fileType);
    const contentType = safeContentType(req.body.contentType);

    if (!fileType || !contentType) {
      return res.status(400).json({ message: "Invalid fileType or contentType" });
    }

    const ext = extFromContentType(contentType);
    const path = `${userId}/${fileType}_${Date.now()}.${ext}`;

    // signed upload url (valid for 2 minutes)
    const { data, error } = await supabaseAdmin.storage
      .from(KYC_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error("createSignedUploadUrl error:", error);
      return res.status(500).json({ message: "Failed to create upload URL" });
    }

    return res.json({
      path,
      signedUrl: data.signedUrl,
    });
  } catch (err) {
    console.error("upload-url crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /kyc/submit
 * body: { fullName, dob, address, idPath, selfiePath }
 */
router.post("/submit", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const fullName = String(req.body.fullName || "").trim();
    const dob = String(req.body.dob || "").trim(); // "YYYY-MM-DD"
    const address = String(req.body.address || "").trim();
    const idPath = String(req.body.idPath || "").trim();
    const selfiePath = String(req.body.selfiePath || "").trim();

    if (!fullName || !dob || !address || !idPath || !selfiePath) {
      return res.status(400).json({ message: "fullName, dob, address, idPath, selfiePath required" });
    }

    // Save only paths, not public URLs
    const payload = {
      user_id: userId,
      full_name: fullName,
      dob,
      address,
      id_path: idPath,
      selfie_path: selfiePath,
      status: "pending",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("kyc_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .maybeSingle();

    if (error) {
      console.error("kyc submit error:", error);
      return res.status(500).json({ message: "Failed to save KYC" });
    }

    return res.json({ message: "KYC submitted", kyc: data });
  } catch (err) {
    console.error("kyc submit crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /kyc/me
 * returns user kyc status + fields
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data, error } = await supabase
      .from("kyc_profiles")
      .select("full_name, dob, address, id_path, selfie_path, status, created_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("kyc me error:", error);
      return res.status(500).json({ message: "Failed to fetch KYC" });
    }

    return res.json({ kyc: data || null });
  } catch (err) {
    console.error("kyc me crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
