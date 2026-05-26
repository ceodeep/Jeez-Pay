package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.ChangePinRequest
import com.jeezpay.app.network.dto.ChangePinResponse
import com.jeezpay.app.network.dto.ForgotPasswordRequestOtpRequest
import com.jeezpay.app.network.dto.ForgotPasswordRequestOtpResponse
import com.jeezpay.app.network.dto.ForgotPasswordVerifyOtpRequest
import com.jeezpay.app.network.dto.ForgotPasswordVerifyOtpResponse
import com.jeezpay.app.network.dto.ForgotPinRequestOtpRequest
import com.jeezpay.app.network.dto.ForgotPinRequestOtpResponse
import com.jeezpay.app.network.dto.ForgotPinVerifyOtpRequest
import com.jeezpay.app.network.dto.ForgotPinVerifyOtpResponse
import com.jeezpay.app.network.dto.LoginRequest
import com.jeezpay.app.network.dto.LoginResponse
import com.jeezpay.app.network.dto.SetPinRequest
import com.jeezpay.app.network.dto.SetPinResponse
import com.jeezpay.app.network.dto.SignupRequestOtpRequest
import com.jeezpay.app.network.dto.SignupRequestOtpResponse
import com.jeezpay.app.network.dto.SignupVerifyOtpRequest
import com.jeezpay.app.network.dto.SignupVerifyOtpResponse
import com.jeezpay.app.network.dto.VerifyPinRequest
import com.jeezpay.app.network.dto.VerifyPinResponse
import com.jeezpay.app.network.safeApiCall
import com.jeezpay.app.network.dto.UpdateAvatarRequest
import com.jeezpay.app.network.dto.UpdateAvatarResponse
import com.jeezpay.app.network.dto.MeResponse
import com.jeezpay.app.network.dto.ReferralSummaryResponse
import com.jeezpay.app.network.dto.ActiveSessionsResponse
import com.jeezpay.app.network.dto.BasicMessageResponse
import com.jeezpay.app.network.dto.ChangePasswordRequest
import com.jeezpay.app.network.dto.ChangePasswordResponse
import android.os.Build


class AuthRepository {

    private val api = ApiClient.authApi

    suspend fun login(phone: String, password: String): LoginResponse {
        return api.login(
            LoginRequest(
                phone = phone,
                password = password,
                deviceName = getDeviceName(),
                appPlatform = "android"
            )
        )
    }

    suspend fun signupRequestOtp(
        fullName: String,
        email: String,
        phone: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean,
        referralCode: String?
    ): SignupRequestOtpResponse {
        return api.signupRequestOtp(
            SignupRequestOtpRequest(
                fullName = fullName,
                email = email,
                phone = phone,
                password = password,
                accountType = accountType,
                countryCode = countryCode,
                termsAccepted = termsAccepted,
                referralCode = referralCode
            )
        )
    }

    suspend fun signupVerifyOtp(
        fullName: String,
        email: String,
        phone: String,
        otp: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean,
        referralCode: String?
    ): SignupVerifyOtpResponse {
        return api.signupVerifyOtp(
            SignupVerifyOtpRequest(
                fullName = fullName,
                email = email,
                phone = phone,
                otp = otp,
                password = password,
                accountType = accountType,
                countryCode = countryCode,
                termsAccepted = termsAccepted,
                referralCode = referralCode
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

    suspend fun loginSafe(phone: String, password: String): ApiResult<LoginResponse> {
        return safeApiCall {
            api.login(LoginRequest(
                phone = phone,
                password = password,
                deviceName = getDeviceName(),
                appPlatform = "android"
            ))
        }
    }

    suspend fun signupRequestOtpSafe(
        fullName: String,
        email: String,
        phone: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean,
        referralCode: String?
    ): ApiResult<SignupRequestOtpResponse> {
        return safeApiCall {
            api.signupRequestOtp(
                SignupRequestOtpRequest(
                    fullName = fullName,
                    email = email,
                    phone = phone,
                    password = password,
                    accountType = accountType,
                    countryCode = countryCode,
                    termsAccepted = termsAccepted,
                    referralCode = referralCode
                )
            )
        }
    }

    suspend fun signupVerifyOtpSafe(
        fullName: String,
        email: String,
        phone: String,
        otp: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean,
        referralCode: String?
    ): ApiResult<SignupVerifyOtpResponse> {
        return safeApiCall {
            api.signupVerifyOtp(
                SignupVerifyOtpRequest(
                    fullName = fullName,
                    email = email,
                    phone = phone,
                    otp = otp,
                    password = password,
                    accountType = accountType,
                    countryCode = countryCode,
                    termsAccepted = termsAccepted,
                    referralCode = referralCode
                )
            )
        }
    }

    suspend fun setPinSafe(pin: String): ApiResult<SetPinResponse> {
        return safeApiCall { api.setPin(SetPinRequest(pin)) }
    }

    suspend fun verifyPinSafe(pin: String): ApiResult<VerifyPinResponse> {
        return safeApiCall { api.verifyPin(VerifyPinRequest(pin)) }
    }

    suspend fun forgotPasswordRequestOtpSafe(phone: String): ApiResult<ForgotPasswordRequestOtpResponse> {
        return safeApiCall {
            api.forgotPasswordRequestOtp(ForgotPasswordRequestOtpRequest(phone))
        }
    }

    suspend fun forgotPasswordVerifyOtpSafe(
        phone: String,
        otp: String,
        newPassword: String
    ): ApiResult<ForgotPasswordVerifyOtpResponse> {
        return safeApiCall {
            api.forgotPasswordVerifyOtp(
                ForgotPasswordVerifyOtpRequest(
                    phone = phone,
                    otp = otp,
                    newPassword = newPassword
                )
            )
        }
    }

    suspend fun forgotPinRequestOtpSafe(phone: String): ApiResult<ForgotPinRequestOtpResponse> {
        return safeApiCall {
            api.forgotPinRequestOtp(ForgotPinRequestOtpRequest(phone))
        }
    }

    suspend fun forgotPinVerifyOtpSafe(
        phone: String,
        otp: String
    ): ApiResult<ForgotPinVerifyOtpResponse> {
        return safeApiCall {
            api.forgotPinVerifyOtp(
                ForgotPinVerifyOtpRequest(
                    phone = phone,
                    otp = otp
                )
            )
        }
    }

    suspend fun updateAvatar(avatarKey: String): UpdateAvatarResponse {
        return api.updateAvatar(UpdateAvatarRequest(avatarKey = avatarKey))
    }

    suspend fun updateAvatarSafe(avatarKey: String): ApiResult<UpdateAvatarResponse> {
        return safeApiCall {
            api.updateAvatar(UpdateAvatarRequest(avatarKey = avatarKey))
        }
    }

    suspend fun me(): MeResponse {
        return api.me()
    }

    suspend fun meSafe(): ApiResult<MeResponse> {
        return safeApiCall {
            api.me()
        }
    }

    suspend fun referralSummarySafe(): ApiResult<ReferralSummaryResponse> {
        return safeApiCall { api.referralSummary() }
    }
    suspend fun changePinSafe(
        currentPin: String,
        newPin: String
    ): ApiResult<ChangePinResponse> {
        return safeApiCall {
            api.changePin(
                ChangePinRequest(
                    currentPin = currentPin,
                    newPin = newPin
                )
            )
        }
    }
    suspend fun activeSessionsSafe(): ApiResult<ActiveSessionsResponse> {
        return safeApiCall {
            api.activeSessions()
        }
    }

    suspend fun revokeSessionSafe(sessionId: String): ApiResult<BasicMessageResponse> {
        return safeApiCall {
            api.revokeSession(sessionId)
        }
    }

    suspend fun logoutOtherSessionsSafe(): ApiResult<BasicMessageResponse> {
        return safeApiCall {
            api.logoutOtherSessions()
        }
    }
    private fun getDeviceName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().replaceFirstChar {
            if (it.isLowerCase()) it.titlecase() else it.toString()
        }

        val model = Build.MODEL.orEmpty()

        return when {
            manufacturer.isBlank() && model.isBlank() -> "Android device"
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }
    }
    suspend fun changePasswordSafe(
        currentPassword: String,
        newPassword: String
    ): ApiResult<ChangePasswordResponse> {
        return safeApiCall {
            api.changePassword(
                ChangePasswordRequest(
                    currentPassword = currentPassword,
                    newPassword = newPassword
                )
            )
        }
    }
}