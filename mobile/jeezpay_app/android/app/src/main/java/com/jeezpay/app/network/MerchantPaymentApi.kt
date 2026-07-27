package com.jeezpay.app.network

import com.jeezpay.app.network.dto.ConfirmMerchantPaymentRequest
import com.jeezpay.app.network.dto.ConfirmMerchantPaymentResponse
import com.jeezpay.app.network.dto.MerchantPaymentDetailsResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface MerchantPaymentApi {

    @GET("wallet/merchant-payments/{id}")
    suspend fun getMerchantPayment(
        @Path("id") id: String
    ): MerchantPaymentDetailsResponse

    @POST("wallet/merchant-payments/{id}/confirm")
    suspend fun confirmMerchantPayment(
        @Path("id") id: String,
        @Body body: ConfirmMerchantPaymentRequest
    ): ConfirmMerchantPaymentResponse
}
