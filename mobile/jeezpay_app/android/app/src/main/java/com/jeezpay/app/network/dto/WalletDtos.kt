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
data class WalletBalanceItem(
    val currency: String = "",
    val balance: Double = 0.0
)
data class WalletHistoryResponse(
    val currency: String? = null,
    val transactions: List<TransactionDto> = emptyList()
)

data class ResolveRecipientResponse(
    val receiver: ResolvedReceiverDto? = null
)

data class ResolvedReceiverDto(
    val id: String? = null,
    val fullName: String? = null,
    val phone: String? = null,
    val walletAccountNumber: Long? = null
)

data class SwapPreviewRequest(
    val fromCurrency: String,
    val toCurrency: String,
    val amount: Double
)

data class SwapConfirmRequest(
    val fromCurrency: String,
    val toCurrency: String,
    val amount: Double,
    val pin: String
)

data class SwapPreviewResponse(
    val fromCurrency: String?,
    val toCurrency: String?,
    val amount: Double?,
    val rate: Double?,
    val fee: Double?,
    val totalDebit: Double?,
    val receiveAmount: Double?
)

data class SwapConfirmResponse(
    val message: String?,
    val reference: String?,
    val fromCurrency: String?,
    val toCurrency: String?,
    val amount: Double?,
    val rate: Double?,
    val fee: Double?,
    val totalDebit: Double?,
    val receiveAmount: Double?,
    val fromBalance: Double?,
    val toBalance: Double?
)
data class CryptoDepositAddressResponse(
    val network: String? = null,
    val token: String? = null,
    val address: String? = null,
    val createdAt: String? = null
)

data class CryptoDepositsResponse(
    val deposits: List<CryptoDepositDto> = emptyList()
)

data class CryptoDepositDto(
    val id: String? = null,
    val network: String? = null,
    val token: String? = null,
    val tx_hash: String? = null,
    val from_address: String? = null,
    val to_address: String? = null,
    val amount: Double? = null,
    val confirmations: Int? = null,
    val status: String? = null,
    val credited_at: String? = null,
    val created_at: String? = null
)
