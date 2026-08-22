package com.jeezpay.app.network.dto

import com.google.gson.annotations.SerializedName

data class AccountLinkMerchantDto(
    val id: String? = null,
    val name: String? = null
)

data class AccountLinkDto(
    val id: String? = null,

    val merchant: AccountLinkMerchantDto? = null,

    @SerializedName("subject_hint")
    val subjectHint: String? = null,

    val status: String? = null,

    @SerializedName("expires_at")
    val expiresAt: String? = null,

    @SerializedName("approved_at")
    val approvedAt: String? = null,

    @SerializedName("cancelled_at")
    val cancelledAt: String? = null,

    val permissions: List<String> = emptyList()
)

data class AccountLinkDetailsResponse(
    @SerializedName("account_link")
    val accountLink: AccountLinkDto? = null
)

data class ApproveAccountLinkRequest(
    val pin: String
)

data class ApproveAccountLinkResponse(
    val ok: Boolean? = null,

    @SerializedName("account_link")
    val accountLink: AccountLinkDto? = null,

    val message: String? = null
)
