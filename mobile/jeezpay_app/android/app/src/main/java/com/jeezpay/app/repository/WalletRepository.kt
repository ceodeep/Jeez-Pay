package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.BalanceResponse
import com.jeezpay.app.network.dto.HistoryResponse
import com.jeezpay.app.network.dto.TransferRequest
import com.jeezpay.app.network.dto.TransferResponse
import com.jeezpay.app.network.safeApiCall
import com.jeezpay.app.network.dto.ResolveRecipientResponse
import com.jeezpay.app.network.dto.SwapPreviewRequest
import com.jeezpay.app.network.dto.SwapPreviewResponse
import com.jeezpay.app.network.dto.SwapConfirmRequest
import com.jeezpay.app.network.dto.SwapConfirmResponse
import com.jeezpay.app.network.dto.CryptoDepositAddressResponse
import com.jeezpay.app.network.dto.CryptoDepositsResponse
import com.jeezpay.app.network.dto.TransferQuoteRequest
import com.jeezpay.app.network.dto.TransferQuoteResponse
import com.jeezpay.app.network.dto.CryptoWithdrawRequest
import com.jeezpay.app.network.dto.CryptoWithdrawResponse
import com.jeezpay.app.network.dto.WithdrawalsResponse

class WalletRepository {

    private val api = ApiClient.walletApi

    // Existing direct methods (keep for compatibility if still used elsewhere)
    suspend fun fetchBalance(currency: String): BalanceResponse {
        return api.getBalances()
    }

    suspend fun fetchHistory(currency: String): HistoryResponse {
        return api.getHistory(currency)
    }

    suspend fun transfer(
        toPhone: String,
        currency: String,
        amount: Double,
        description: String?,
        pin: String
    ): TransferResponse {
        return api.transfer(
            TransferRequest(
                phone = toPhone,
                currency = currency,
                amount = amount,
                description = description,
                pin = pin
            )
        )
    }

    suspend fun fetchBalances(): BalanceResponse {
        return api.getBalances()
    }

    // Safe methods for new global error handling
    suspend fun fetchBalanceSafe(currency: String): ApiResult<BalanceResponse> {
        return safeApiCall { api.getBalances() }
    }

    suspend fun fetchHistorySafe(currency: String): ApiResult<HistoryResponse> {
        return safeApiCall { api.getHistory(currency) }
    }

    suspend fun transferSafe(
        toPhone: String,
        currency: String,
        amount: Double,
        description: String?,
        pin: String
    ): ApiResult<TransferResponse> {
        return safeApiCall {
            api.transfer(
                TransferRequest(
                    phone = toPhone,
                    currency = currency,
                    amount = amount,
                    description = description,
                    pin = pin
                )
            )
        }
    }

    suspend fun fetchBalancesSafe(): ApiResult<BalanceResponse> {
        return safeApiCall { api.getBalances() }
    }

    suspend fun resolveRecipientSafe(
        identifier: String
    ): ApiResult<ResolveRecipientResponse> {
        return safeApiCall {
            api.resolveRecipient(identifier)
        }
    }

    suspend fun swapPreviewSafe(
        fromCurrency: String,
        toCurrency: String,
        amount: Double
    ): ApiResult<SwapPreviewResponse> {
        return safeApiCall {
            api.swapPreview(
                SwapPreviewRequest(
                    fromCurrency = fromCurrency,
                    toCurrency = toCurrency,
                    amount = amount
                )
            )
        }
    }

    suspend fun swapConfirmSafe(
        fromCurrency: String,
        toCurrency: String,
        amount: Double,
        pin: String
    ): ApiResult<SwapConfirmResponse> {
        return safeApiCall {
            api.swapConfirm(
                SwapConfirmRequest(
                    fromCurrency = fromCurrency,
                    toCurrency = toCurrency,
                    amount = amount,
                    pin = pin
                )
            )
        }
    }
    suspend fun cryptoDepositAddressSafe(
        token: String = "USDT",
        network: String = "TRON"
    ): ApiResult<CryptoDepositAddressResponse> {
        return safeApiCall {
            api.cryptoDepositAddress(token, network)
        }
    }

    suspend fun cryptoDepositsSafe(
        token: String = "USDT",
        network: String = "TRON"
    ): ApiResult<CryptoDepositsResponse> {
        return safeApiCall {
            api.cryptoDeposits(token, network)
        }
    }
    suspend fun transferQuoteSafe(
        currency: String,
        amount: Double
    ): ApiResult<TransferQuoteResponse> {
        return safeApiCall {
            api.transferQuote(
                TransferQuoteRequest(
                    currency = currency,
                    amount = amount
                )
            )
        }
    }
    suspend fun cryptoWithdrawSafe(
        toAddress: String,
        amount: Double,
        pin: String
    ): ApiResult<CryptoWithdrawResponse> {
        return safeApiCall {
            api.cryptoWithdraw(
                CryptoWithdrawRequest(
                    toAddress = toAddress,
                    amount = amount,
                    pin = pin
                )
            )
        }
    }

    suspend fun cryptoWithdrawalsSafe():
            ApiResult<WithdrawalsResponse> {

        return safeApiCall {
            api.cryptoWithdrawals()
        }
    }
}