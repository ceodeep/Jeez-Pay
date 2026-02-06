package com.jeezpay.app.model

data class Transaction(
    val title: String,
    val date: String,
    val amount: String,
    val isPositive: Boolean
)
