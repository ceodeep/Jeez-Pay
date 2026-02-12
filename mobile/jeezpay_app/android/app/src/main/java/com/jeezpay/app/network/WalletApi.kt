package com.jeezpay.app.network

import com.jeezpay.app.network.dto.BalanceResponse
import com.jeezpay.app.network.dto.HistoryResponse
import retrofit2.http.GET
import retrofit2.http.Query
import retrofit2.http.Body
import retrofit2.http.POST



interface WalletApi {

    @GET("wallet/balance")
    suspend fun getBalance(
        @Query("currency") currency: String
    ): BalanceResponse

    @GET("wallet/history")
    suspend fun getHistory(
        @Query("currency") currency: String
    ): HistoryResponse

    @POST("wallet/transfer")
    suspend fun transfer(@Body body: com.jeezpay.app.network.dto.TransferRequest)
            : com.jeezpay.app.network.dto.TransferResponse
}
