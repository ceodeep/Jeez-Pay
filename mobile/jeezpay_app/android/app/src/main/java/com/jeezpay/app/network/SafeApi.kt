package com.jeezpay.app.network

import org.json.JSONArray
import org.json.JSONObject
import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException

suspend fun <T> safeApiCall(apiCall: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Success(apiCall())
    } catch (_: SocketTimeoutException) {
        ApiResult.Error(
            AppError.Server("The server took too long to respond. Please try again.")
        )
    } catch (_: IOException) {
        ApiResult.Error(AppError.NoInternet)
    } catch (e: HttpException) {
        val backendError = extractBackendError(e)
        val message = friendlyBackendMessage(
            code = backendError.code,
            fallback = backendError.message,
            httpCode = e.code()
        )

        when (e.code()) {
            401 -> {
                ApiResult.Error(
                    AppError.Unauthorized(
                        message.ifBlank {
                            "Your session has expired. Please login again."
                        }
                    )
                )
            }

            400, 403, 404, 409, 410, 422, 423, 429 -> {
                ApiResult.Error(
                    AppError.Validation(
                        message.ifBlank {
                            "We couldn't process your request. Please check the details and try again."
                        }
                    )
                )
            }

            in 500..599 -> {
                ApiResult.Error(
                    AppError.Server(
                        message.ifBlank {
                            "Service temporarily unavailable. Please try again."
                        }
                    )
                )
            }

            else -> {
                ApiResult.Error(
                    AppError.Unknown(
                        message.ifBlank {
                            "Something went wrong. Please try again."
                        }
                    )
                )
            }
        }
    } catch (e: Exception) {
        val msg = cleanRawMessage(e.message.orEmpty()).ifBlank {
            "Something went wrong. Please try again."
        }
        ApiResult.Error(AppError.Unknown(msg))
    }
}

private data class BackendError(
    val code: String = "",
    val message: String = "",
)

private fun extractBackendError(e: HttpException): BackendError {
    return try {
        val raw = e.response()?.errorBody()?.string().orEmpty()
        if (raw.isBlank()) return BackendError()

        val json = JSONObject(raw)

        val code = jsonValueToString(json.opt("code"))
            .ifBlank { jsonValueToString(json.opt("error_code")) }
            .ifBlank { jsonValueToString(json.opt("errorCode")) }

        val message = jsonValueToString(json.opt("message"))
            .ifBlank { jsonValueToString(json.opt("error")) }
            .ifBlank { jsonValueToString(json.opt("detail")) }
            .ifBlank { jsonValueToString(json.opt("details")) }

        BackendError(
            code = code.trim(),
            message = cleanRawMessage(message),
        )
    } catch (_: Exception) {
        BackendError()
    }
}

private fun jsonValueToString(value: Any?): String {
    return when (value) {
        null -> ""
        JSONObject.NULL -> ""
        is String -> value
        is JSONArray -> {
            buildString {
                for (i in 0 until value.length()) {
                    val item = value.opt(i)
                    val text = jsonValueToString(item)
                    if (text.isNotBlank()) {
                        if (isNotBlank()) append("\n")
                        append(text)
                    }
                }
            }
        }
        is JSONObject -> jsonValueToString(value.opt("message"))
            .ifBlank { jsonValueToString(value.opt("error")) }
            .ifBlank { value.toString() }
        else -> value.toString()
    }
}

private fun friendlyBackendMessage(
    code: String,
    fallback: String,
    httpCode: Int,
): String {
    val cleanFallback = cleanRawMessage(fallback)
    val normalizedCode = code.trim().uppercase()

    return when (normalizedCode) {
        "KYC_REQUIRED" -> "Complete KYC to continue."
        "PIN_INVALID", "INVALID_PIN", "WRONG_PIN" -> "Invalid PIN. Please check your PIN and try again."
        "PIN_LOCKED" -> "Too many wrong PIN attempts. Try again later."
        "PIN_REQUIRED" -> "Enter your transaction PIN to continue."
        "PIN_NOT_SET" -> "Set a transaction PIN before continuing."
        "ACCOUNT_NOT_ELIGIBLE" -> "Your JeezPay account is not eligible for this connection."
        "ACCOUNT_LINK_NOT_FOUND" -> "This account connection request was not found."
        "AUTHORIZATION_EXPIRED" -> "This account connection request has expired."
        "AUTHORIZATION_CANCELLED" -> "This account connection request was cancelled."
        "AUTHORIZATION_NOT_PENDING" -> "This account connection request is no longer pending."
        "MERCHANT_NOT_AVAILABLE" -> "This merchant is currently unavailable."
        "INSUFFICIENT_BALANCE" -> "Insufficient balance."
        "PAYMENT_EXPIRED" -> "This payment has expired. Please create a new checkout."
        "PAYMENT_NOT_PENDING" -> "This payment is no longer pending."
        "PAYMENT_NOT_FOUND" -> "Payment not found."
        "MERCHANT_DISABLED" -> "This merchant is currently unavailable."
        "UNSUPPORTED_CURRENCY" -> "This currency is not supported."
        "AMOUNT_TOO_LOW" -> "The payment amount is below the minimum allowed."
        "AMOUNT_TOO_HIGH" -> "The payment amount is above the maximum allowed."
        "RATE_LIMITED", "TOO_MANY_REQUESTS" -> "Too many attempts. Please wait and try again."
        "SESSION_EXPIRED", "TOKEN_EXPIRED", "UNAUTHORIZED" -> "Your session has expired. Please login again."
        else -> cleanFallback.ifBlank {
            when (httpCode) {
                400 -> "We couldn't process your request. Please check the details and try again."
                401 -> "Your session has expired. Please login again."
                403 -> "You cannot complete this action right now. Please check your account requirements."
                404 -> "The requested item was not found."
                409 -> "This action conflicts with the current status. Please refresh and try again."
                410 -> "This request has expired."
                422 -> "Some details are invalid. Please check and try again."
                423 -> "Your transaction PIN is temporarily locked."
                429 -> "Too many attempts. Please wait and try again."
                in 500..599 -> "Service temporarily unavailable. Please try again."
                else -> "Something went wrong. Please try again."
            }
        }
    }
}

private fun cleanRawMessage(message: String): String {
    val text = message.trim()
    if (text.isBlank()) return ""

    val lower = text.lowercase()

    if (lower == "forbidden") return ""
    if (lower == "unauthorized") return ""
    if (lower == "not found") return ""
    if (lower.startsWith("http ")) return ""
    if (lower.contains("http 403")) return ""
    if (lower.contains("response.error")) return ""
    if (lower.contains("retrofit2.httpexception")) return ""

    return text
}
