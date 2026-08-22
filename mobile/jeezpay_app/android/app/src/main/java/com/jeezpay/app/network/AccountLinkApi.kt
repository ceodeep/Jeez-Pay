package com.jeezpay.app.network

import com.jeezpay.app.network.dto.AccountLinkDetailsResponse
import com.jeezpay.app.network.dto.ApproveAccountLinkRequest
import com.jeezpay.app.network.dto.ApproveAccountLinkResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface AccountLinkApi {

    @GET("wallet/account-links/{id}")
    suspend fun getAccountLink(
        @Path("id") id: String
    ): AccountLinkDetailsResponse

    @POST("wallet/account-links/{id}/approve")
    suspend fun approveAccountLink(
        @Path("id") id: String,
        @Body body: ApproveAccountLinkRequest
    ): ApproveAccountLinkResponse
}
