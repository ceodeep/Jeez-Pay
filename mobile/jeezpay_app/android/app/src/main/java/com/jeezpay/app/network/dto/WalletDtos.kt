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

data class ServiceRequestCreateRequest(
    val serviceType: String,
    val provider: String?,
    val customerReference: String,
    val currency: String,
    val amount: Double,
    val note: String?,
    val pin: String
)

data class ServiceRequestCreateResponse(
    val message: String?,
    val request: ServiceRequestDto?
)

data class ServiceRequestsResponse(
    val requests: List<ServiceRequestDto> = emptyList()
)

data class ServiceRequestDto(
    val id: String? = null,
    val service_type: String? = null,
    val provider: String? = null,
    val customer_reference: String? = null,
    val currency: String? = null,
    val amount: Double? = null,
    val status: String? = null,
    val note: String? = null,
    val admin_note: String? = null,
    val transaction_reference: String? = null,
    val created_at: String? = null,
    val completed_at: String? = null,
    val rejected_at: String? = null
)

data class TransferQuoteRequest(
    val currency: String,
    val amount: Double
)

data class TransferQuoteResponse(
    val currency: String? = null,
    val amount: Double? = null,
    val fee: Double? = null,
    val totalDebit: Double? = null,
    val feePercent: Double? = null,
    val flatFee: Double? = null,
    val minTransfer: Double? = null,
    val maxTransfer: Double? = null,
    val isEnabled: Boolean? = null
)

data class CryptoWithdrawRequest(
    val toAddress: String,
    val amount: Double,
    val pin: String,
    val network: String
)

data class CryptoWithdrawResponse(
    val message: String? = null,
    val amount: Double? = null,
    val fee: Double? = null,
    val totalDebit: Double? = null,
    val txHash: String? = null,
    val reference: Long? = null
)
