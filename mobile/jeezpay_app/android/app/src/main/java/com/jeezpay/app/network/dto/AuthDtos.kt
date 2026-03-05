package com.jeezpay.app.network.dto

// -------- REQUESTS --------

data class RequestOtpRequest(
    val phone: String
)

data class VerifyOtpRequest(
    val phone: String,
    val otp: String
)

// -------- RESPONSES --------

data class RequestOtpResponse(
    val message: String
)

data class VerifyOtpResponse(
    val message: String,
    val token: String,
    val isNewUser: Boolean = false,
    val hasPin: Boolean = false   // ✅ ADD THIS
)

data class AuthResponse(
    val message: String,
    val token: String,
    val isNewUser: Boolean = false
)


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