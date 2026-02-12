package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.BalanceResponse
import com.jeezpay.app.network.dto.HistoryResponse
import com.jeezpay.app.network.dto.WalletHistoryResponse
import com.jeezpay.app.network.dto.WalletBalanceResponse

class WalletRepository {

    private val api = ApiClient.walletApi

    suspend fun fetchBalance(currency: String): BalanceResponse {
        return api.getBalance(currency)
    }

    suspend fun fetchHistory(currency: String): HistoryResponse {
        return api.getHistory(currency)
    }
    suspend fun transfer(toPhone: String, currency: String, amount: Double, description: String?)
            : com.jeezpay.app.network.dto.TransferResponse {
        return api.transfer(
            com.jeezpay.app.network.dto.TransferRequest(
                phone = toPhone,
                currency = currency,
                amount = amount,
                description = description
            )
        )
    }


}
