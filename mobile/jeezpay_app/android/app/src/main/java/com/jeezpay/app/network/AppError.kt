package com.jeezpay.app.network

sealed class AppError {
    data object NoInternet : AppError()
    data class Server(val message: String = "We couldn't complete your request right now.") : AppError()
    data class Unauthorized(val message: String = "Your session has expired. Please login again.") : AppError()
    data class Validation(val message: String) : AppError()
    data class Unknown(val message: String = "Something went wrong.") : AppError()
}

sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error(val error: AppError) : ApiResult<Nothing>()
}