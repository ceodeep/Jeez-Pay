package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.RequestOtpRequest
import com.jeezpay.app.network.dto.RequestOtpResponse
import com.jeezpay.app.network.dto.SetPinRequest
import com.jeezpay.app.network.dto.VerifyOtpRequest
import com.jeezpay.app.network.dto.VerifyOtpResponse
import com.jeezpay.app.network.dto.VerifyPinRequest

class AuthRepository {

    private val api = ApiClient.authApi

    suspend fun requestOtp(phone: String): RequestOtpResponse {
        return api.requestOtp(RequestOtpRequest(phone))
    }

    suspend fun verifyOtp(phone: String, otp: String): VerifyOtpResponse {
        return api.verifyOtp(VerifyOtpRequest(phone, otp))
    }

    // ✅ NEW: store pin on backend
    suspend fun setPin(pin: String) {
        api.setPin(SetPinRequest(pin))
    }

    // ✅ NEW: verify pin on backend
    suspend fun verifyPin(pin: String): Boolean {
        val res = api.verifyPin(VerifyPinRequest(pin))
        return res.ok
    }
}