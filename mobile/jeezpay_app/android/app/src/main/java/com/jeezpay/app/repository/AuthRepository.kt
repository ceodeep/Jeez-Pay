package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.RequestOtpRequest
import com.jeezpay.app.network.dto.RequestOtpResponse
import com.jeezpay.app.network.dto.VerifyOtpRequest
import com.jeezpay.app.network.dto.VerifyOtpResponse

class AuthRepository {
    private val api = ApiClient.authApi

    suspend fun requestOtp(phone: String): RequestOtpResponse {
        return ApiClient.authApi.requestOtp(RequestOtpRequest(phone))
    }

    suspend fun verifyOtp(phone: String, otp: String): VerifyOtpResponse {
        return ApiClient.authApi.verifyOtp(VerifyOtpRequest(phone, otp))
    }
}
