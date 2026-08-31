package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.network.safeApiCall

class ProductRepository {
    private val api = ApiClient.productApi

    suspend fun fetchCapabilitiesSafe(
        countryCode: String
    ): ApiResult<ProductCapabilitiesResponse> {
        return safeApiCall {
            api.getCapabilities(countryCode)
        }
    }
}
