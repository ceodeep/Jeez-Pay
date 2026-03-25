package com.jeezpay.app.repository

import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.safeApiCall
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

    // SAFE METHODS — add these
    suspend fun meSafe(): ApiResult<KycMeResponse> {
        return safeApiCall {
            ApiClient.kycApi.me()
        }
    }

    suspend fun uploadUrlSafe(
        fileType: String,
        contentType: String
    ): ApiResult<KycUploadUrlResponse> {
        return safeApiCall {
            ApiClient.kycApi.uploadUrl(
                KycUploadUrlRequest(fileType, contentType)
            )
        }
    }

    suspend fun submitSafe(
        req: KycSubmitRequest
    ): ApiResult<KycSubmitResponse> {
        return safeApiCall {
            ApiClient.kycApi.submit(req)
        }
    }
}