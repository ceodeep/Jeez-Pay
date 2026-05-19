package com.jeezpay.app.network

import com.jeezpay.app.network.dto.ServiceRequestCreateRequest
import com.jeezpay.app.network.dto.ServiceRequestCreateResponse
import com.jeezpay.app.network.dto.ServiceRequestsResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface ServicesApi {

    @POST("services/request")
    suspend fun createRequest(
        @Body body: ServiceRequestCreateRequest
    ): ServiceRequestCreateResponse

    @GET("services/my-requests")
    suspend fun myRequests(): ServiceRequestsResponse
}