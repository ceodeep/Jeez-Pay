package com.jeezpay.app.network.dto

data class TransactionDto(
    val type: String,          // "credit" | "debit"
    val amount: Double,
    val description: String?,
    val created_at: String
)
