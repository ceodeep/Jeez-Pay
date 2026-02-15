package com.jeezpay.app.network.dto

data class KycMeResponse(
    val kyc: KycProfile?
)

data class KycProfile(
    val full_name: String?,
    val dob: String?,
    val address: String?,
    val id_path: String?,
    val selfie_path: String?,
    val status: String?, // "pending" | "approved" | "rejected" (you can extend later)
    val created_at: String?,
    val updated_at: String?
)

data class KycUploadUrlRequest(
    val fileType: String,     // "id" | "selfie"
    val contentType: String   // "image/jpeg" | "image/png" | "application/pdf"
)

data class KycUploadUrlResponse(
    val path: String,
    val signedUrl: String
)

data class KycSubmitRequest(
    val fullName: String,
    val dob: String,      // "YYYY-MM-DD"
    val address: String,
    val idPath: String,
    val selfiePath: String
)

data class KycSubmitResponse(
    val message: String,
    val kyc: SubmittedKyc?
)

data class SubmittedKyc(
    val user_id: String?,
    val full_name: String?,
    val dob: String?,
    val address: String?,
    val id_path: String?,
    val selfie_path: String?,
    val status: String?,
    val created_at: String?,
    val updated_at: String?
)
