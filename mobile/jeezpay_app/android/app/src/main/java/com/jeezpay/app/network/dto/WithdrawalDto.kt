package com.jeezpay.app.network.dto

data class WithdrawalDto(
    val id: String?,
    val amount: Double?,
    val fee: Double?,
    val network: String?,
    val token: String?,
    val to_address: String?,
    val tx_hash: String?,
    val reference: String?,
    val status: String?,
    val created_at: String?
)
