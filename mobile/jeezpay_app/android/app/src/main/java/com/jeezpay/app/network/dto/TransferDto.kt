package com.jeezpay.app.network.dto

data class TransferRequest(
    val phone: String,
    val currency: String,
    val amount: Double,
    val description: String? = null
)

data class TransferResponse(
    val message: String,
    val currency: String? = null,
    val amount: Double? = null,
    val phone: String? = null,
    val reference: String? = null
)
