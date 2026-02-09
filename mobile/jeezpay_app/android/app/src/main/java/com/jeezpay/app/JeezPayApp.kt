package com.jeezpay.app

import android.app.Application
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.storage.SessionManager

class JeezPayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiClient.init(SessionManager(this))
    }
}
