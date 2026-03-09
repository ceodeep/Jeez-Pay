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