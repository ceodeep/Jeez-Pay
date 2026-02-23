package com.jeezpay.app.models

data class BalanceItem(
    val currency: String,
    val balance: Double
)

data class BalanceResponse(
    val balances: List<BalanceItem> = emptyList()
)