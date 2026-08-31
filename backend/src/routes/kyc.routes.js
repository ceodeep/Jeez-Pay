const express = require("express");

const router = express.Router();

const supabase = require("../config/supabase");
const supabaseAdmin = require("../config/supabaseAdmin");
const authMiddleware = require("../middlewares/auth.middleware");

const KYC_BUCKET = "kyc-documents";
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
]);

function normalizeFileType(value) {
  const fileType = String(value || "").trim().toLowerCase();
  return fileType === "id" || fileType === "selfie" ? fileType : null;
}

function normalizeContentType(value) {
  const contentType = String(value || "").trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : null;
}

function extensionForContentType(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "application/pdf") return "pdf";
  return "jpg";
}

router.get("/ping", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "kyc",
    ts: new Date().toISOString(),
  });
});

// Keep the kyc-documents bucket private in Supabase.
// The client receives a short-lived signed upload URL and the database stores
// only the private object path.
router.post("/upload-url", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const fileType = normalizeFileType(req.body.fileType);
    const contentType = normalizeContentType(req.body.contentType);

    if (!fileType || !contentType) {
      return res.status(400).json({
        message: "Invalid fileType or contentType",
      });
    }

    const extension = extensionForContentType(contentType);
    const path = `${userId}/${fileType}_${Date.now()}.${extension}`;

    const { data, error } = await supabaseAdmin.storage
      .from(KYC_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error("createSignedUploadUrl error:", error);
      return res.status(500).json({
        message: "Failed to create upload URL",
      });
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

router.post("/submit", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const fullName = String(req.body.fullName || "").trim();
    const dob = String(req.body.dob || "").trim();
    const address = String(req.body.address || "").trim();
    const idPath = String(req.body.idPath || "").trim();
    const selfiePath = String(req.body.selfiePath || "").trim();

    if (!fullName || !dob || !address || !idPath || !selfiePath) {
      return res.status(400).json({
        message: "fullName, dob, address, idPath, selfiePath required",
      });
    }

    const payload = {
      user_id: userId,
      fullName,
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

    return res.json({
      message: "KYC submitted",
      kyc: data,
    });
  } catch (err) {
    console.error("kyc submit crash:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data, error } = await supabase
      .from("kyc_profiles")
      .select(
        "fullName, dob, address, id_path, selfie_path, status, created_at, updated_at"
      )
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
