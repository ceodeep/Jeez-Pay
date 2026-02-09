package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.WalletHistoryResponse
import com.jeezpay.app.network.dto.WalletBalanceResponse

class WalletRepository {

    private val api = ApiClient.walletApi

    suspend fun fetchBalance(): WalletBalanceResponse {
        return api.getBalance()
    }

    suspend fun fetchHistory(): WalletHistoryResponse {
        return api.getHistory()
    }
}
