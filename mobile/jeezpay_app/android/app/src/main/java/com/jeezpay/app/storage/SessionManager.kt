package com.jeezpay.app.storage

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

@Suppress("DEPRECATION")
class SessionManager(context: Context) {

    private val appContext = context.applicationContext

    private val prefs: SharedPreferences = createSafePrefs(appContext)

    private fun createSafePrefs(context: Context): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                context,
                PREF_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.e("SessionManager", "Encrypted prefs failed. Using fallback prefs.", e)

            try {
                context.getSharedPreferences(FALLBACK_PREF_NAME, Context.MODE_PRIVATE)
            } catch (fallbackError: Exception) {
                Log.e("SessionManager", "Fallback prefs failed. Using default prefs.", fallbackError)
                context.getSharedPreferences("jeezpay_default_session", Context.MODE_PRIVATE)
            }
        }
    }

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun savePhone(phone: String) {
        prefs.edit().putString(KEY_PHONE, phone).apply()
    }

    fun getPhone(): String? = prefs.getString(KEY_PHONE, null)

    fun savePin(pin: String) {
        val salt = generateSalt()
        val hash = hashPin(pin, salt)

        prefs.edit()
            .putString(KEY_PIN_SALT, salt.toHex())
            .putString(KEY_PIN_HASH, hash.toHex())
            .remove(KEY_LEGACY_PIN)
            .apply()
    }

    fun verifyPin(inputPin: String): Boolean {
        val saltHex = prefs.getString(KEY_PIN_SALT, null) ?: return false
        val storedHashHex = prefs.getString(KEY_PIN_HASH, null) ?: return false

        val salt = saltHex.hexToBytes()
        val computedHash = hashPin(inputPin, salt).toHex()

        return storedHashHex == computedHash
    }

    fun hasPin(): Boolean {
        return !prefs.getString(KEY_PIN_HASH, null).isNullOrBlank()
    }

    fun clearPin() {
        prefs.edit()
            .remove(KEY_PIN_HASH)
            .remove(KEY_PIN_SALT)
            .remove(KEY_LEGACY_PIN)
            .remove(KEY_PIN_FAILED_ATTEMPTS)
            .remove(KEY_PIN_LOCK_UNTIL)
            .apply()
    }

    fun clearAll() {
        val biometricEnabled = isBiometricEnabled()

        prefs.edit()
            .clear()
            .putBoolean(KEY_BIOMETRIC_ENABLED, biometricEnabled)
            .commit()
    }

    fun getFailedPinAttempts(): Int = prefs.getInt(KEY_PIN_FAILED_ATTEMPTS, 0)

    fun incrementFailedPinAttempts(): Int {
        val newCount = getFailedPinAttempts() + 1
        prefs.edit().putInt(KEY_PIN_FAILED_ATTEMPTS, newCount).apply()
        return newCount
    }

    fun resetFailedPinAttempts() {
        prefs.edit()
            .putInt(KEY_PIN_FAILED_ATTEMPTS, 0)
            .remove(KEY_PIN_LOCK_UNTIL)
            .apply()
    }

    fun lockPinForMillis(durationMillis: Long) {
        val lockUntil = System.currentTimeMillis() + durationMillis
        prefs.edit().putLong(KEY_PIN_LOCK_UNTIL, lockUntil).apply()
    }

    fun getPinLockRemainingMillis(): Long {
        val lockUntil = prefs.getLong(KEY_PIN_LOCK_UNTIL, 0L)
        val remaining = lockUntil - System.currentTimeMillis()
        return if (remaining > 0) remaining else 0L
    }

    fun isPinLocked(): Boolean = getPinLockRemainingMillis() > 0L

    fun isBiometricEnabled(): Boolean {
        return prefs.getBoolean(KEY_BIOMETRIC_ENABLED, false)
    }

    fun setBiometricEnabled(enabled: Boolean) {
        prefs.edit()
            .putBoolean(KEY_BIOMETRIC_ENABLED, enabled)
            .apply()
    }

    private fun generateSalt(size: Int = 16): ByteArray {
        val salt = ByteArray(size)
        SecureRandom().nextBytes(salt)
        return salt
    }

    private fun hashPin(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(
            pin.toCharArray(),
            salt,
            PBKDF2_ITERATIONS,
            KEY_LENGTH_BITS
        )
        val factory = SecretKeyFactory.getInstance(PBKDF2_ALGORITHM)
        return factory.generateSecret(spec).encoded
    }

    private fun ByteArray.toHex(): String =
        joinToString("") { "%02x".format(it) }

    private fun String.hexToBytes(): ByteArray {
        val clean = trim()
        val result = ByteArray(clean.length / 2)
        var i = 0
        while (i < clean.length) {
            val byte = clean.substring(i, i + 2).toInt(16)
            result[i / 2] = byte.toByte()
            i += 2
        }
        return result
    }

    companion object {
        private const val PREF_NAME = "jeezpay_secure_session"
        private const val FALLBACK_PREF_NAME = "jeezpay_session_fallback"

        private const val KEY_TOKEN = "token"
        private const val KEY_PHONE = "phone"
        private const val KEY_PIN_HASH = "pin_hash"
        private const val KEY_PIN_SALT = "pin_salt"
        private const val KEY_LEGACY_PIN = "pin"
        private const val KEY_PIN_FAILED_ATTEMPTS = "pin_failed_attempts"
        private const val KEY_PIN_LOCK_UNTIL = "pin_lock_until"
        private const val PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256"
        private const val PBKDF2_ITERATIONS = 120_000
        private const val KEY_LENGTH_BITS = 256

        const val MAX_PIN_ATTEMPTS = 5
        const val PIN_LOCK_DURATION_MS = 60_000L
        private const val KEY_BIOMETRIC_ENABLED = "biometric_enabled"
    }
}