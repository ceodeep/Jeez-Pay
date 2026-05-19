package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.dto.ServiceRequestCreateRequest
import com.jeezpay.app.network.dto.ServiceRequestCreateResponse
import com.jeezpay.app.network.dto.ServiceRequestsResponse
import com.jeezpay.app.network.safeApiCall

class ServicesRepository {

    private val api = ApiClient.servicesApi

    suspend fun createRequestSafe(
        serviceType: String,
        provider: String?,
        customerReference: String,
        currency: String,
        amount: Double,
        note: String?,
        pin: String
    ): ApiResult<ServiceRequestCreateResponse> {
        return safeApiCall {
            api.createRequest(
                ServiceRequestCreateRequest(
                    serviceType = serviceType,
                    provider = provider,
                    customerReference = customerReference,
                    currency = currency,
                    amount = amount,
                    note = note,
                    pin = pin
                )
            )
        }
    }

    suspend fun myRequestsSafe(): ApiResult<ServiceRequestsResponse> {
        return safeApiCall {
            api.myRequests()
        }
    }
}