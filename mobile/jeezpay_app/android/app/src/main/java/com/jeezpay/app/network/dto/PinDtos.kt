package com.jeezpay.app.network.dto

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
    val message: String? = null
)