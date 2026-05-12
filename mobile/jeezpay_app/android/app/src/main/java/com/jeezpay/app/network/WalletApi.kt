package com.jeezpay.app.network

import com.jeezpay.app.network.dto.HistoryResponse
import com.jeezpay.app.network.dto.TransferRequest
import com.jeezpay.app.network.dto.TransferResponse
import com.jeezpay.app.network.dto.WalletBalanceResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import com.jeezpay.app.network.dto.ResolveRecipientResponse


interface WalletApi {

    // ✅ backend returns ALL balances: { balances: [...] }
    @GET("wallet/balance")
    suspend fun getBalances(): com.jeezpay.app.network.dto.BalanceResponse

    @GET("wallet/history")
    suspend fun getHistory(
        @Query("currency") currency: String
    ): com.jeezpay.app.network.dto.HistoryResponse

    @POST("wallet/transfer")
    suspend fun transfer(
        @Body body: com.jeezpay.app.network.dto.TransferRequest
    ): com.jeezpay.app.network.dto.TransferResponse

    @GET("wallet/recipient/resolve")
    suspend fun resolveRecipient(
        @Query("identifier") identifier: String
    ): ResolveRecipientResponse

}