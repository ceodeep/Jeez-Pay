package com.jeezpay.app

data class TransactionItem(
    val merchant: String,
    val cardMask: String,
    val time: String,
    val amount: String,
    val status: String
)
