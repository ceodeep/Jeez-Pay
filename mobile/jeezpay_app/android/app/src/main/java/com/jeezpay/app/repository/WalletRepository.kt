package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.BalanceResponse
import com.jeezpay.app.network.dto.HistoryResponse
import com.jeezpay.app.network.dto.TransferRequest
import com.jeezpay.app.network.dto.TransferResponse
import com.jeezpay.app.network.safeApiCall
import com.jeezpay.app.network.dto.ResolveRecipientResponse

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
}