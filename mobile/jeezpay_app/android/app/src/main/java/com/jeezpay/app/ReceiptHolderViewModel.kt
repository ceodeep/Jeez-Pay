package com.jeezpay.app

import androidx.lifecycle.ViewModel

data class ReceiptState(
    val toPhone: String = "",
    val currency: String = "",
    val amount: Double = 0.0,
    val description: String = "",
    val createdAt: String = ""
)

class ReceiptHolderViewModel : ViewModel() {

    var receipt: ReceiptState? = null
        private set

    fun setReceipt(
        toPhone: String,
        currency: String,
        amount: Double,
        description: String?,
        createdAt: String
    ) {
        receipt = ReceiptState(
            toPhone = toPhone,
            currency = currency,
            amount = amount,
            description = description ?: "",
            createdAt = createdAt
        )
    }

    fun clear() {
        receipt = null
    }
}
