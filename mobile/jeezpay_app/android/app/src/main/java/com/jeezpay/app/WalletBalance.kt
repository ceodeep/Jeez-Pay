package com.jeezpay.app

import androidx.annotation.DrawableRes

data class WalletBalance(
    val code: String,
    val name: String,
    @DrawableRes val iconRes: Int,
    var amount: Double
)
