package com.jeezpay.app.network

import com.jeezpay.app.storage.SessionManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object ApiClient {

    // Emulator -> PC localhost
    private const val BASE_URL = "https://jeez-pay.onrender.com"

    private lateinit var sessionManager: SessionManager
    private lateinit var retrofit: Retrofit

    fun init(session: SessionManager) {
        sessionManager = session

        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val authInterceptor = Interceptor { chain ->
            val original = chain.request()
            val token = sessionManager.getToken()

            val request = if (!token.isNullOrBlank()) {
                original.newBuilder()
                    .addHeader("Authorization", "Bearer $token")
                    .build()
            } else {
                original
            }

            chain.proceed(request)
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()

        retrofit = Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    // ---- APIs ----
    val authApi: AuthApi by lazy {
        retrofit.create(AuthApi::class.java)
    }

    val walletApi: WalletApi by lazy {
        retrofit.create(WalletApi::class.java)
    }
}
