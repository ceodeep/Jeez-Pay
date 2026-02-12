package com.jeezpay.app.network.dto

data class TransferRequest(
    val phone: String,
    val currency: String,
    val amount: Double,
    val description: String? = null
)

data class TransferResponse(
    val message: String,
    val result: TransferResult? = null
)

data class TransferResult(
    val currency: String,
    val amount: Double,
    val sender_new_balance: Double,
    val receiver_new_balance: Double
)
