package com.jeezpay.app.network

import com.jeezpay.app.network.dto.WalletBalanceResponse
import com.jeezpay.app.network.dto.WalletHistoryResponse
import retrofit2.http.GET

interface WalletApi {

    @GET("wallet/balance")
    suspend fun getBalance(): WalletBalanceResponse

    @GET("wallet/history")
    suspend fun getHistory(): WalletHistoryResponse
}
