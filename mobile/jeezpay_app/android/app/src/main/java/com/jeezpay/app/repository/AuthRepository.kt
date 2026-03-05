package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.*

class AuthRepository {

    private val api = ApiClient.authApi

    suspend fun requestOtp(phone: String): RequestOtpResponse {
        return api.requestOtp(RequestOtpRequest(phone))
    }

    suspend fun verifyOtp(phone: String, otp: String): VerifyOtpResponse {
        return api.verifyOtp(VerifyOtpRequest(phone, otp))
    }

    suspend fun setPin(pin: String): SetPinResponse {
        return api.setPin(SetPinRequest(pin))
    }

    suspend fun verifyPin(pin: String): Boolean {
        val res = api.verifyPin(VerifyPinRequest(pin))
        return res.ok
    }
}