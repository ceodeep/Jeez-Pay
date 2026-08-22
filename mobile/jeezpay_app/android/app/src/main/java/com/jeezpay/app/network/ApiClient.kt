package com.jeezpay.app.network

import com.jeezpay.app.storage.SessionManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object ApiClient {

    private const val BASE_URL = "http://217.144.154.171/"

    private var sessionManager: SessionManager? = null

    private val logging: HttpLoggingInterceptor by lazy {
        HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
    }

    private val authInterceptor = Interceptor { chain ->
        val original = chain.request()
        val token = sessionManager?.getToken()

        val request = if (!token.isNullOrBlank()) {
            original.newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        } else {
            original
        }

        chain.proceed(request)
    }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()
    }

    private val retrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun init(session: SessionManager) {
        sessionManager = session
    }

    val authApi: AuthApi by lazy {
        retrofit.create(AuthApi::class.java)
    }

    val walletApi: WalletApi by lazy {
        retrofit.create(WalletApi::class.java)
    }

    val merchantPaymentApi: MerchantPaymentApi by lazy {
        retrofit.create(MerchantPaymentApi::class.java)
    }

    val accountLinkApi: AccountLinkApi by lazy {
        retrofit.create(AccountLinkApi::class.java)
    }


    val servicesApi: ServicesApi by lazy {
        retrofit.create(ServicesApi::class.java)
    }

    val kycApi: KycApi by lazy {
        retrofit.create(KycApi::class.java)
    }
}

