package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.KycMeResponse
import com.jeezpay.app.network.dto.KycSubmitRequest
import com.jeezpay.app.network.dto.KycSubmitResponse
import com.jeezpay.app.network.dto.KycUploadUrlRequest
import com.jeezpay.app.network.dto.KycUploadUrlResponse

class KycRepository {

    suspend fun me(): KycMeResponse = ApiClient.kycApi.me()

    suspend fun uploadUrl(fileType: String, contentType: String): KycUploadUrlResponse {
        return ApiClient.kycApi.uploadUrl(KycUploadUrlRequest(fileType, contentType))
    }

    suspend fun submit(req: KycSubmitRequest): KycSubmitResponse {
        return ApiClient.kycApi.submit(req)
    }
}
