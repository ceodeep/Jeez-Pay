package com.jeezpay.app.storage

import android.content.Context

class SessionManager(context: Context) {

    private val prefs = context.getSharedPreferences("jeezpay_session", Context.MODE_PRIVATE)

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun savePin(pin: String) {
        prefs.edit().putString(KEY_PIN, pin).apply()
    }

    fun getPin(): String? = prefs.getString(KEY_PIN, null)

    // ✅ NEW: phone
    fun savePhone(phone: String) {
        prefs.edit().putString(KEY_PHONE, phone).apply()
    }

    fun getPhone(): String? = prefs.getString(KEY_PHONE, null)

    fun clearAll() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_TOKEN = "token"
        private const val KEY_PIN = "pin"
        private const val KEY_PHONE = "phone" // ✅ NEW
    }
}
