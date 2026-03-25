package com.jeezpay.app.network

import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException

suspend fun <T> safeApiCall(apiCall: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Success(apiCall())
    } catch (e: SocketTimeoutException) {
        ApiResult.Error(AppError.Server("The server took too long to respond. Please try again."))
    } catch (e: IOException) {
        // Most network-level issues land here
        ApiResult.Error(AppError.NoInternet)
    } catch (e: HttpException) {
        when (e.code()) {
            401 -> ApiResult.Error(AppError.Unauthorized())
            400, 403, 404, 422 -> {
                val msg = e.message()?.takeIf { it.isNotBlank() }
                    ?: "We couldn't process your request."
                ApiResult.Error(AppError.Validation(msg))
            }
            in 500..599 -> ApiResult.Error(AppError.Server())
            else -> ApiResult.Error(AppError.Unknown())
        }
    } catch (e: Exception) {
        val msg = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong."
        ApiResult.Error(AppError.Unknown(msg))
    }
}