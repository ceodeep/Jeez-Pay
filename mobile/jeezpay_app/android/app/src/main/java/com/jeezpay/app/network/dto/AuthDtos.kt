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
    val token: String
)
