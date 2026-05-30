package com.jeezpay.app.network

import com.jeezpay.app.network.dto.ActiveSessionsResponse
import com.jeezpay.app.network.dto.BasicMessageResponse
import com.jeezpay.app.network.dto.ChangePinRequest
import com.jeezpay.app.network.dto.ChangePinResponse
import com.jeezpay.app.network.dto.ForgotPasswordRequestOtpRequest
import com.jeezpay.app.network.dto.ForgotPasswordRequestOtpResponse
import com.jeezpay.app.network.dto.ForgotPasswordVerifyOtpRequest
import com.jeezpay.app.network.dto.ForgotPasswordVerifyOtpResponse
import com.jeezpay.app.network.dto.ForgotPinRequestOtpRequest
import com.jeezpay.app.network.dto.ForgotPinRequestOtpResponse
import com.jeezpay.app.network.dto.ForgotPinVerifyOtpRequest
import com.jeezpay.app.network.dto.ForgotPinVerifyOtpResponse
import com.jeezpay.app.network.dto.LoginRequest
import com.jeezpay.app.network.dto.LoginResponse
import com.jeezpay.app.network.dto.SetPinRequest
import com.jeezpay.app.network.dto.SetPinResponse
import com.jeezpay.app.network.dto.SignupRequestOtpRequest
import com.jeezpay.app.network.dto.SignupRequestOtpResponse
import com.jeezpay.app.network.dto.SignupVerifyOtpRequest
import com.jeezpay.app.network.dto.SignupVerifyOtpResponse
import com.jeezpay.app.network.dto.UpdateAvatarRequest
import com.jeezpay.app.network.dto.UpdateAvatarResponse
import com.jeezpay.app.network.dto.VerifyPinRequest
import com.jeezpay.app.network.dto.VerifyPinResponse
import com.jeezpay.app.network.dto.MeResponse
import com.jeezpay.app.network.dto.ReferralSummaryResponse
import com.jeezpay.app.network.dto.ChangePasswordRequest
import com.jeezpay.app.network.dto.ChangePasswordResponse
import com.jeezpay.app.network.dto.ChangeEmailRequestOtpRequest
import com.jeezpay.app.network.dto.ChangeEmailRequestOtpResponse
import com.jeezpay.app.network.dto.ChangeEmailVerifyOtpRequest
import com.jeezpay.app.network.dto.ChangeEmailVerifyOtpResponse
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.POST
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.Path

interface AuthApi {

    @GET("auth/me")
    suspend fun me(): MeResponse

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("auth/signup/request-otp")
    suspend fun signupRequestOtp(@Body body: SignupRequestOtpRequest): SignupRequestOtpResponse

    @POST("auth/signup/verify-otp")
    suspend fun signupVerifyOtp(@Body body: SignupVerifyOtpRequest): SignupVerifyOtpResponse

    @POST("auth/set-pin")
    suspend fun setPin(@Body body: SetPinRequest): SetPinResponse

    @POST("auth/change-pin")
    suspend fun changePin(
        @Body body: ChangePinRequest
    ): ChangePinResponse

    @POST("auth/verify-pin")
    suspend fun verifyPin(@Body body: VerifyPinRequest): VerifyPinResponse

    @POST("auth/forgot-password/request-otp")
    suspend fun forgotPasswordRequestOtp(
        @Body body: ForgotPasswordRequestOtpRequest
    ): ForgotPasswordRequestOtpResponse

    @POST("auth/forgot-password/verify-otp")
    suspend fun forgotPasswordVerifyOtp(
        @Body body: ForgotPasswordVerifyOtpRequest
    ): ForgotPasswordVerifyOtpResponse

    @POST("auth/forgot-pin/request-otp")
    suspend fun forgotPinRequestOtp(
        @Body body: ForgotPinRequestOtpRequest
    ): ForgotPinRequestOtpResponse

    @POST("auth/forgot-pin/verify-otp")
    suspend fun forgotPinVerifyOtp(
        @Body body: ForgotPinVerifyOtpRequest
    ): ForgotPinVerifyOtpResponse

    @PATCH("auth/avatar")
    suspend fun updateAvatar(
        @Body request: UpdateAvatarRequest
    ): UpdateAvatarResponse

    @GET("auth/referrals/summary")
    suspend fun referralSummary(): ReferralSummaryResponse

    @GET("auth/sessions")
    suspend fun activeSessions(): ActiveSessionsResponse

    @DELETE("auth/sessions/{sessionId}")
    suspend fun revokeSession(
        @Path("sessionId") sessionId: String
    ): BasicMessageResponse

    @POST("auth/sessions/logout-others")
    suspend fun logoutOtherSessions(): BasicMessageResponse

    @POST("auth/change-password")
    suspend fun changePassword(
        @Body body: ChangePasswordRequest
    ): ChangePasswordResponse

    @POST("auth/change-email/request-otp")
    suspend fun changeEmailRequestOtp(
        @Body body: ChangeEmailRequestOtpRequest
    ): ChangeEmailRequestOtpResponse

    @POST("auth/change-email/verify-otp")
    suspend fun changeEmailVerifyOtp(
        @Body body: ChangeEmailVerifyOtpRequest
    ): ChangeEmailVerifyOtpResponse


}


