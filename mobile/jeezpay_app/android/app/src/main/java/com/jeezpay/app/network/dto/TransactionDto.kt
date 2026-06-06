package com.jeezpay.app.network.dto

data class TransactionDto(
    val id: String? = null,
    val wallet_id: String? = null,
    val type: String? = null,
    val amount: Double? = null,
    val description: String? = null,
    val reference: Long? = null,
    val created_at: String? = null
)
