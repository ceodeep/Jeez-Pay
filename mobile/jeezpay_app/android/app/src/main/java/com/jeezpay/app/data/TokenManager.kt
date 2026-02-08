package com.jeezpay.app.data

import android.content.Context

class TokenManager(context: Context) {

    private val prefs = context.getSharedPreferences("jeezpay_prefs", Context.MODE_PRIVATE)

    fun saveToken(token: String) {
        prefs.edit().putString("token", token).apply()
    }

    fun getToken(): String? = prefs.getString("token", null)

    fun isLoggedIn(): Boolean = !getToken().isNullOrBlank()

    fun savePin(pin: String) {
        prefs.edit().putString("pin", pin).apply()
        prefs.edit().putBoolean("pin_set", true).apply()
    }

    fun isPinSet(): Boolean = prefs.getBoolean("pin_set", false) && !getPin().isNullOrBlank()

    fun getPin(): String? = prefs.getString("pin", null)

    fun logout() {
        prefs.edit().remove("token").apply()
        prefs.edit().remove("pin").apply()
        prefs.edit().putBoolean("pin_set", false).apply()
    }
}
