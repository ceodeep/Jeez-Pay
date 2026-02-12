package com.jeezpay.app.network.dto

data class BalanceResponse(
    val balance: Double
)



data class TxItem(
    val type: String,
    val amount: Double,
    val description: String?,
    val created_at: String
)

data class HistoryResponse(
    val transactions: List<TransactionDto> = emptyList()
)

data class WalletBalanceResponse(
    val balance: Double
)

data class WalletHistoryResponse(
    val transactions: List<TransactionDto>
)
