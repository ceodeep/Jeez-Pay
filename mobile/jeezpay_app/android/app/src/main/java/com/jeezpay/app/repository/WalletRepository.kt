package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.BalanceResponse
import com.jeezpay.app.network.dto.HistoryResponse
import com.jeezpay.app.network.dto.TransferRequest
import com.jeezpay.app.network.dto.TransferResponse

class WalletRepository {

    private val api = ApiClient.walletApi

    // ✅ Keep the same name so MainActivity doesn’t change
    // ✅ Return BalanceResponse so MainActivity can use res.balances
    suspend fun fetchBalance(currency: String): BalanceResponse {
        // Backend returns all balances; we return them as-is.
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

    // ✅ returns ALL balances (backend behavior)
    suspend fun fetchBalances(): com.jeezpay.app.network.dto.BalanceResponse {
        return api.getBalances()
    }
}