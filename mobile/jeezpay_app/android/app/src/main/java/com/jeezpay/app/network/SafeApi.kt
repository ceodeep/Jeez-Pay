package com.jeezpay.app.network

import org.json.JSONObject
import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException

suspend fun <T> safeApiCall(apiCall: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Success(apiCall())
    } catch (e: SocketTimeoutException) {
        ApiResult.Error(
            AppError.Server("The server took too long to respond. Please try again.")
        )
    } catch (e: IOException) {
        ApiResult.Error(AppError.NoInternet)
    } catch (e: HttpException) {
        val backendMessage = extractBackendMessage(e)

        when (e.code()) {
            401 -> {
                ApiResult.Error(
                    AppError.Unauthorized(
                        backendMessage.ifBlank {
                            "Your session has expired. Please login again."
                        }
                    )
                )
            }

            400, 403, 404, 422 -> {
                ApiResult.Error(
                    AppError.Validation(
                        backendMessage.ifBlank {
                            "We couldn't process your request."
                        }
                    )
                )
            }

            in 500..599 -> {
                ApiResult.Error(
                    AppError.Server(
                        backendMessage.ifBlank {
                            "We couldn't complete your request right now."
                        }
                    )
                )
            }

            else -> {
                ApiResult.Error(
                    AppError.Unknown(
                        backendMessage.ifBlank {
                            "Something went wrong."
                        }
                    )
                )
            }
        }
    } catch (e: Exception) {
        val msg = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong."
        ApiResult.Error(AppError.Unknown(msg))
    }
}

private fun extractBackendMessage(e: HttpException): String {
    return try {
        val raw = e.response()?.errorBody()?.string().orEmpty()
        if (raw.isBlank()) return ""

        val json = JSONObject(raw)

        json.optString("message")
            .ifBlank { json.optString("error") }
            .ifBlank { json.optString("detail") }
    } catch (_: Exception) {
        ""
    }
}