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
    val termsAccepted: Boolean
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
    val termsAccepted: Boolean
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