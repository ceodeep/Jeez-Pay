package com.jeezpay.app.network

import com.jeezpay.app.network.dto.RequestOtpRequest
import com.jeezpay.app.network.dto.RequestOtpResponse
import com.jeezpay.app.network.dto.SetPinRequest
import com.jeezpay.app.network.dto.SetPinResponse
import com.jeezpay.app.network.dto.VerifyOtpRequest
import com.jeezpay.app.network.dto.VerifyOtpResponse
import com.jeezpay.app.network.dto.VerifyPinRequest
import com.jeezpay.app.network.dto.VerifyPinResponse
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApi {

    @POST("auth/request-otp")
    suspend fun requestOtp(@Body body: RequestOtpRequest): RequestOtpResponse

    @POST("auth/verify-otp")
    suspend fun verifyOtp(@Body body: VerifyOtpRequest): VerifyOtpResponse

    // ✅ NEW
    @POST("auth/set-pin")
    suspend fun setPin(@Body body: SetPinRequest): SetPinResponse

    // ✅ NEW
    @POST("auth/verify-pin")
    suspend fun verifyPin(@Body body: VerifyPinRequest): VerifyPinResponse
}