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
import com.jeezpay.app.network.dto.SwapConfirmRequest
import com.jeezpay.app.network.dto.SwapConfirmResponse
import com.jeezpay.app.network.dto.SwapPreviewRequest
import com.jeezpay.app.network.dto.SwapPreviewResponse
import com.jeezpay.app.network.dto.CryptoDepositAddressResponse


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

    @POST("wallet/swap/preview")
    suspend fun swapPreview(
        @Body body: SwapPreviewRequest
    ): SwapPreviewResponse

    @POST("wallet/swap/confirm")
    suspend fun swapConfirm(
        @Body body: SwapConfirmRequest
    ): SwapConfirmResponse

    @GET("wallet/crypto/deposit-address")
    suspend fun cryptoDepositAddress(
        @Query("token") token: String = "USDT",
        @Query("network") network: String = "TRON"
    ): CryptoDepositAddressResponse

}