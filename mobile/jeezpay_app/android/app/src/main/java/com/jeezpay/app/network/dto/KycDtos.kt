package com.jeezpay.app.network.dto

data class KycPolicyResponse(
    val schemaVersion: Int,
    val policyVersion: Int,
    val policyCode: String,
    val privacyNoticeVersion: String,
    val biometricNoticeVersion: String,
    val maxUploadBytes: Long,
    val requirements: Map<String, Any>? = null
)

data class KycMeResponse(
    val kyc: KycProfile?
)

data class KycProfile(
    val fullName: String?,
    val dob: String?,
    val address: String?,
    val id_path: String?,
    val selfie_path: String?,
    val status: String?,
    val created_at: String?,
    val updated_at: String?,
    val applicationId: String? = null,
    val applicationVersion: Int? = null,
    val schemaVersion: Int? = null,
    val policyVersion: Int? = null,
    val workflowStatus: String? = null,
    val assuranceLevel: String? = null,
    val verificationMode: String? = null,
    val rejectionReason: String? = null,
    val reviewedAt: String? = null,
    val submittedAt: String? = null,
    val nextReviewAt: String? = null,
    val requiredAction: String? = null,
    val hasIdDocument: Boolean = false,
    val hasSelfie: Boolean = false,
    val nationality: String? = null,
    val countryOfBirth: String? = null,
    val residenceCountry: String? = null,
    val addressLine1: String? = null,
    val addressLine2: String? = null,
    val city: String? = null,
    val region: String? = null,
    val postalCode: String? = null,
    val employmentStatus: String? = null,
    val occupation: String? = null,
    val employerName: String? = null,
    val sourceOfFunds: List<String> = emptyList(),
    val accountPurpose: String? = null,
    val expectedMonthlyVolumeBand: String? = null,
    val expectedMonthlyTxCountBand: String? = null,
    val pepSelfDeclared: Boolean = false,
    val pepRelatedDeclared: Boolean = false
)

data class KycUploadUrlRequest(
    val fileType: String,
    val contentType: String,
    val schemaVersion: Int? = null
)

data class KycUploadUrlResponse(
    val path: String,
    val signedUrl: String,
    val expiresAt: String? = null,
    val maxBytes: Long? = null,
    val schemaVersion: Int? = null
)

data class KycDocumentRequest(
    val documentType: String,
    val issuingCountry: String,
    val documentNumber: String,
    val issueDate: String? = null,
    val expiryDate: String? = null,
    val noExpiry: Boolean = false,
    val frontPath: String,
    val backPath: String? = null,
    val selfiePath: String
)

data class KycConsentsRequest(
    val privacyAccepted: Boolean,
    val identityVerificationAccepted: Boolean,
    val biometricAccepted: Boolean,
    val ongoingScreeningAccepted: Boolean,
    val privacyNoticeVersion: String,
    val biometricNoticeVersion: String
)

data class KycSubmitRequest(
    val schemaVersion: Int = 3,
    val fullName: String,
    val dob: String,
    val nationality: String,
    val countryOfBirth: String,
    val residenceCountry: String,
    val addressLine1: String,
    val addressLine2: String? = null,
    val city: String,
    val region: String? = null,
    val postalCode: String? = null,
    val employmentStatus: String,
    val occupation: String,
    val employerName: String? = null,
    val sourceOfFunds: List<String>,
    val sourceOfWealth: String? = null,
    val accountPurpose: String,
    val expectedMonthlyVolumeBand: String,
    val expectedMonthlyTxCountBand: String? = null,
    val pepSelfDeclared: Boolean,
    val pepRelatedDeclared: Boolean,
    val taxResidencies: List<String> = emptyList(),
    val document: KycDocumentRequest,
    val consents: KycConsentsRequest
)

data class KycSubmitResponse(
    val message: String,
    val kyc: SubmittedKyc?
)

data class SubmittedKyc(
    val user_id: String? = null,
    val fullName: String? = null,
    val dob: String? = null,
    val address: String? = null,
    val id_path: String? = null,
    val selfie_path: String? = null,
    val status: String? = null,
    val created_at: String? = null,
    val updated_at: String? = null,
    val workflowStatus: String? = null,
    val applicationId: String? = null,
    val applicationVersion: Int? = null,
    val schemaVersion: Int? = null,
    val policyVersion: Int? = null
)
