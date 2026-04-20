package com.jeezpay.app.network.dto

// -------- LOGIN --------

data class LoginRequest(
    val phone: String,
    val password: String
)

data class LoginResponse(
    val message: String,
    val token: String,
    val hasPin: Boolean = false,
    val isNewUser: Boolean = false
)

// -------- SIGNUP OTP --------

data class SignupRequestOtpRequest(
    val fullName: String,
    val phone: String,
    val password: String,
    val accountType: String,
    val countryCode: String,
    val termsAccepted: Boolean,
    val referralCode: String? = null
)

data class SignupRequestOtpResponse(
    val message: String
)

data class SignupVerifyOtpRequest(
    val fullName: String,
    val phone: String,
    val otp: String,
    val password: String,
    val accountType: String,
    val countryCode: String,
    val termsAccepted: Boolean,
    val referralCode: String? = null
)

data class SignupVerifyOtpResponse(
    val message: String,
    val token: String,
    val hasPin: Boolean = false,
    val isNewUser: Boolean = true
)

// -------- PIN --------

data class SetPinRequest(
    val pin: String
)

data class SetPinResponse(
    val message: String
)

data class VerifyPinRequest(
    val pin: String
)

data class VerifyPinResponse(
    val ok: Boolean,
    val message: String? = null,
    val code: String? = null
)

data class ForgotPasswordRequestOtpRequest(
    val phone: String
)

data class ForgotPasswordRequestOtpResponse(
    val message: String
)

data class ForgotPasswordVerifyOtpRequest(
    val phone: String,
    val otp: String,
    val newPassword: String
)

data class ForgotPasswordVerifyOtpResponse(
    val message: String,
    val token: String,
    val hasPin: Boolean = false,
    val isNewUser: Boolean = false
)

data class ForgotPinRequestOtpRequest(
    val phone: String
)

data class ForgotPinRequestOtpResponse(
    val message: String
)

data class ForgotPinVerifyOtpRequest(
    val phone: String,
    val otp: String
)

data class ForgotPinVerifyOtpResponse(
    val message: String,
    val token: String,
    val hasPin: Boolean = false,
    val isNewUser: Boolean = false
)

data class UpdateAvatarRequest(
    val avatarKey: String
)

data class UpdateAvatarResponse(
    val message: String,
    val avatarKey: String?
)

data class MeResponse(
    val message: String?,
    val user: MeUser?
)

data class MeUser(
    val id: String?,
    val phone: String?,
    val fullName: String?,
    val avatar_key: String?,
    val referral_code: String?,
    val referred_by_user_id: String?,
    val role: String?,
    val account_type: String?,
    val country_code: String?,
    val phone_verified: Boolean?,
    val terms_accepted: Boolean?
)