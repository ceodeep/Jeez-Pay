package com.jeezpay.app.network

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
import com.jeezpay.app.network.dto.VerifyPinRequest
import com.jeezpay.app.network.dto.VerifyPinResponse
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApi {

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("auth/signup/request-otp")
    suspend fun signupRequestOtp(@Body body: SignupRequestOtpRequest): SignupRequestOtpResponse

    @POST("auth/signup/verify-otp")
    suspend fun signupVerifyOtp(@Body body: SignupVerifyOtpRequest): SignupVerifyOtpResponse

    @POST("auth/set-pin")
    suspend fun setPin(@Body body: SetPinRequest): SetPinResponse

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
}


