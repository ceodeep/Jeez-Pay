package com.jeezpay.app.network

import com.jeezpay.app.network.dto.RequestOtpRequest
import com.jeezpay.app.network.dto.RequestOtpResponse
import com.jeezpay.app.network.dto.VerifyOtpRequest
import com.jeezpay.app.network.dto.VerifyOtpResponse
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApi {

    @POST("auth/request-otp")
    suspend fun requestOtp(@Body body: RequestOtpRequest): RequestOtpResponse

    @POST("auth/verify-otp")
    suspend fun verifyOtp(@Body body: VerifyOtpRequest): VerifyOtpResponse
}
