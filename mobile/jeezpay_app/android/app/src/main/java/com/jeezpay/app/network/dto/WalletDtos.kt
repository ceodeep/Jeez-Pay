package com.jeezpay.app.network.dto

import com.google.gson.annotations.SerializedName

// ---------- BALANCE ----------
data class BalanceItem(
    val currency: String,
    val balance: Double
)

data class BalanceResponse(
    @SerializedName(value = "balances", alternate = ["balance"])
    val balances: List<BalanceItem> = emptyList()
)

// ---------- HISTORY ----------

data class HistoryResponse(
    val currency: String? = null,
    val transactions: List<TransactionDto> = emptyList()
)

// Keep these only if you REALLY use them somewhere else.
// Otherwise delete them to avoid confusion.
data class WalletBalanceResponse(
    val balances: List<BalanceItem> = emptyList()
)

data class WalletHistoryResponse(
    val currency: String? = null,
    val transactions: List<TransactionDto> = emptyList()
)
