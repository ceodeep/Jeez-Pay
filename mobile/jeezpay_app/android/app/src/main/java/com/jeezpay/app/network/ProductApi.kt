package com.jeezpay.app.network

import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import retrofit2.http.GET
import retrofit2.http.Query

interface ProductApi {
    @GET("products/capabilities")
    suspend fun getCapabilities(
        @Query("country") countryCode: String
    ): ProductCapabilitiesResponse
}
