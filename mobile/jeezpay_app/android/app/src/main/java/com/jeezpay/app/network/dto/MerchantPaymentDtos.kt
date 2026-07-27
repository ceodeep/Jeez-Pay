package com.jeezpay.app.network.dto

import com.google.gson.annotations.SerializedName

data class MerchantPaymentDetailsResponse(
    val payment: MerchantPaymentDto? = null
)

data class MerchantPaymentDto(
    val id: String? = null,

    @SerializedName("merchant_order_id")
    val merchantOrderId: String? = null,

    val amount: String? = null,
    val currency: String? = null,
    val description: String? = null,
    val status: String? = null,

    @SerializedName("expires_at")
    val expiresAt: String? = null,

    @SerializedName("paid_at")
    val paidAt: String? = null,

    @SerializedName("success_url")
    val successUrl: String? = null,

    @SerializedName("cancel_url")
    val cancelUrl: String? = null,

    val merchants: MerchantInfoDto? = null
)

data class MerchantInfoDto(
    val id: String? = null,
    val name: String? = null,
    val status: String? = null
)

data class ConfirmMerchantPaymentRequest(
    val pin: String
)

data class ConfirmMerchantPaymentResponse(
    val ok: Boolean? = null,
    val code: String? = null,
    val message: String? = null,

    @SerializedName("payment_id")
    val paymentId: String? = null,

    @SerializedName("merchant_order_id")
    val merchantOrderId: String? = null,

    val amount: String? = null,
    val currency: String? = null,
    val status: String? = null,
    val reference: String? = null,

    @SerializedName("wallet_balance")
    val walletBalance: String? = null,

    @SerializedName("merchant_balance")
    val merchantBalance: String? = null
)
