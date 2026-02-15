package com.jeezpay.app.network

import com.jeezpay.app.network.dto.KycMeResponse
import com.jeezpay.app.network.dto.KycSubmitRequest
import com.jeezpay.app.network.dto.KycSubmitResponse
import com.jeezpay.app.network.dto.KycUploadUrlRequest
import com.jeezpay.app.network.dto.KycUploadUrlResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface KycApi {

    @GET("kyc/me")
    suspend fun me(): KycMeResponse

    @POST("kyc/upload-url")
    suspend fun uploadUrl(@Body body: KycUploadUrlRequest): KycUploadUrlResponse

    @POST("kyc/submit")
    suspend fun submit(@Body body: KycSubmitRequest): KycSubmitResponse
}
