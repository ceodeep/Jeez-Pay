package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.*


class AuthRepository {

    private val api = ApiClient.authApi

    suspend fun login(phone: String, password: String): LoginResponse {
        return api.login(
            LoginRequest(
                phone = phone,
                password = password
            )
        )
    }

    suspend fun signupRequestOtp(
        phone: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean
    ): SignupRequestOtpResponse {
        return api.signupRequestOtp(
            SignupRequestOtpRequest(
                phone = phone,
                password = password,
                accountType = accountType,
                countryCode = countryCode,
                termsAccepted = termsAccepted
            )
        )
    }

    suspend fun signupVerifyOtp(
        phone: String,
        otp: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean
    ): SignupVerifyOtpResponse {
        return api.signupVerifyOtp(
            SignupVerifyOtpRequest(
                phone = phone,
                otp = otp,
                password = password,
                accountType = accountType,
                countryCode = countryCode,
                termsAccepted = termsAccepted
            )
        )
    }

    suspend fun setPin(pin: String): SetPinResponse {
        return api.setPin(SetPinRequest(pin))
    }

    suspend fun verifyPin(pin: String): VerifyPinResponse {
        return api.verifyPin(VerifyPinRequest(pin))
    }

    suspend fun forgotPasswordRequestOtp(phone: String): ForgotPasswordRequestOtpResponse {
        return api.forgotPasswordRequestOtp(
            ForgotPasswordRequestOtpRequest(phone)
        )
    }

    suspend fun forgotPasswordVerifyOtp(
        phone: String,
        otp: String,
        newPassword: String
    ): ForgotPasswordVerifyOtpResponse {
        return api.forgotPasswordVerifyOtp(
            ForgotPasswordVerifyOtpRequest(
                phone = phone,
                otp = otp,
                newPassword = newPassword
            )
        )
    }

    suspend fun forgotPinRequestOtp(phone: String): ForgotPinRequestOtpResponse {
        return api.forgotPinRequestOtp(
            ForgotPinRequestOtpRequest(phone)
        )
    }

    suspend fun forgotPinVerifyOtp(
        phone: String,
        otp: String
    ): ForgotPinVerifyOtpResponse {
        return api.forgotPinVerifyOtp(
            ForgotPinVerifyOtpRequest(
                phone = phone,
                otp = otp
            )
        )
    }
}