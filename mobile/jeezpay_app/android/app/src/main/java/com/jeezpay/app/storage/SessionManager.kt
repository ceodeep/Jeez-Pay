package com.jeezpay.app.storage

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.PSource

@Suppress("DEPRECATION")
class SessionManager(context: Context) {

    private val prefs: SharedPreferences =
        createEncryptedPrefs(context.applicationContext)

    private fun createEncryptedPrefs(context: Context): SharedPreferences {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            return EncryptedSharedPreferences.create(
                context,
                PREF_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (error: Exception) {
            throw IllegalStateException(
                "Secure session storage is unavailable. Refusing to use unencrypted storage.",
                error
            )
        }
    }

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(): String? =
        prefs.getString(KEY_TOKEN, null)

    fun savePhone(phone: String) {
        prefs.edit().putString(KEY_PHONE, phone).apply()
    }

    fun getPhone(): String? =
        prefs.getString(KEY_PHONE, null)

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
        val saltHex =
            prefs.getString(KEY_PIN_SALT, null)
                ?: return false

        val storedHashHex =
            prefs.getString(KEY_PIN_HASH, null)
                ?: return false

        val salt = saltHex.hexToBytes()
        val computedHash = hashPin(inputPin, salt).toHex()

        return storedHashHex == computedHash
    }

    fun hasPin(): Boolean {
        return !prefs.getString(
            KEY_PIN_HASH,
            null
        ).isNullOrBlank()
    }

    fun clearPin() {
        clearBiometricPinMaterial()

        prefs.edit()
            .remove(KEY_PIN_HASH)
            .remove(KEY_PIN_SALT)
            .remove(KEY_LEGACY_PIN)
            .remove(KEY_PIN_FAILED_ATTEMPTS)
            .remove(KEY_PIN_LOCK_UNTIL)
            .putBoolean(KEY_BIOMETRIC_ENABLED, false)
            .apply()
    }

    fun clearAll() {
        clearBiometricPinMaterial()

        // Biometric authorization is account-specific.
        // Never carry it across logout/account switching.
        prefs.edit()
            .clear()
            .commit()
    }

    fun getFailedPinAttempts(): Int =
        prefs.getInt(KEY_PIN_FAILED_ATTEMPTS, 0)

    fun incrementFailedPinAttempts(): Int {
        val newCount = getFailedPinAttempts() + 1

        prefs.edit()
            .putInt(KEY_PIN_FAILED_ATTEMPTS, newCount)
            .apply()

        return newCount
    }

    fun resetFailedPinAttempts() {
        prefs.edit()
            .putInt(KEY_PIN_FAILED_ATTEMPTS, 0)
            .remove(KEY_PIN_LOCK_UNTIL)
            .apply()
    }

    fun lockPinForMillis(durationMillis: Long) {
        val lockUntil =
            System.currentTimeMillis() + durationMillis

        prefs.edit()
            .putLong(KEY_PIN_LOCK_UNTIL, lockUntil)
            .apply()
    }

    fun getPinLockRemainingMillis(): Long {
        val lockUntil =
            prefs.getLong(KEY_PIN_LOCK_UNTIL, 0L)

        val remaining =
            lockUntil - System.currentTimeMillis()

        return if (remaining > 0) remaining else 0L
    }

    fun isPinLocked(): Boolean =
        getPinLockRemainingMillis() > 0L

    fun isBiometricEnabled(): Boolean {
        return prefs.getBoolean(
            KEY_BIOMETRIC_ENABLED,
            false
        )
    }

    fun setBiometricEnabled(enabled: Boolean) {
        if (!enabled) {
            clearBiometricPinMaterial()
        }

        prefs.edit()
            .putBoolean(
                KEY_BIOMETRIC_ENABLED,
                enabled
            )
            .apply()
    }

    // ==========================================================
    // BIOMETRIC-PROTECTED TRANSACTION PIN
    //
    // The real PIN is never stored as plaintext.
    //
    // It is encrypted using the PUBLIC portion of an Android
    // Keystore RSA key pair.
    //
    // The PRIVATE key requires BIOMETRIC_STRONG authentication
    // for every decryption operation.
    // ==========================================================

    fun provisionBiometricPin(pin: String): Boolean {
        if (!isBiometricEnabled()) return false
        if (!Regex("^\\d{4}$").matches(pin)) return false
        if (!verifyPin(pin)) return false

        return try {
            ensureBiometricKey()

            val keyStore = loadAndroidKeyStore()

            val publicKey =
                keyStore
                    .getCertificate(BIOMETRIC_KEY_ALIAS)
                    ?.publicKey
                    ?: return false

            val cipher =
                Cipher.getInstance(
                    BIOMETRIC_CIPHER_TRANSFORMATION
                )

            cipher.init(
                Cipher.ENCRYPT_MODE,
                publicKey,
                biometricOaepSpec()
            )

            val encrypted =
                cipher.doFinal(
                    pin.toByteArray(Charsets.UTF_8)
                )

            prefs.edit()
                .putString(
                    KEY_BIOMETRIC_PIN_CIPHERTEXT,
                    Base64.encodeToString(
                        encrypted,
                        Base64.NO_WRAP
                    )
                )
                .commit()

        } catch (_: Exception) {
            false
        }
    }

    fun hasBiometricPinCredential(): Boolean {
        val encrypted =
            prefs.getString(
                KEY_BIOMETRIC_PIN_CIPHERTEXT,
                null
            )

        if (encrypted.isNullOrBlank()) {
            return false
        }

        return try {
            loadAndroidKeyStore()
                .containsAlias(BIOMETRIC_KEY_ALIAS)
        } catch (_: Exception) {
            false
        }
    }

    fun createBiometricPinDecryptCipher(): Cipher? {
        if (!isBiometricEnabled()) return null
        if (!hasBiometricPinCredential()) return null

        return try {
            val keyStore = loadAndroidKeyStore()

            val privateKey =
                keyStore.getKey(
                    BIOMETRIC_KEY_ALIAS,
                    null
                ) as? PrivateKey
                    ?: return null

            Cipher.getInstance(
                BIOMETRIC_CIPHER_TRANSFORMATION
            ).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    privateKey,
                    biometricOaepSpec()
                )
            }

        } catch (_: KeyPermanentlyInvalidatedException) {
            clearBiometricPinMaterial()
            null
        } catch (_: Exception) {
            null
        }
    }

    fun decryptBiometricPin(cipher: Cipher): String? {
        val encoded =
            prefs.getString(
                KEY_BIOMETRIC_PIN_CIPHERTEXT,
                null
            ) ?: return null

        return try {
            val encrypted =
                Base64.decode(
                    encoded,
                    Base64.NO_WRAP
                )

            val pin =
                String(
                    cipher.doFinal(encrypted),
                    Charsets.UTF_8
                )

            if (
                Regex("^\\d{4}$").matches(pin) &&
                verifyPin(pin)
            ) {
                pin
            } else {
                null
            }

        } catch (_: Exception) {
            null
        }
    }

    fun invalidateBiometricPinCredential() {
        clearBiometricPinMaterial()
    }

    private fun ensureBiometricKey() {
        val keyStore = loadAndroidKeyStore()

        if (
            keyStore.containsAlias(
                BIOMETRIC_KEY_ALIAS
            )
        ) {
            return
        }

        val generator =
            KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_RSA,
                ANDROID_KEYSTORE
            )

        val builder =
            KeyGenParameterSpec.Builder(
                BIOMETRIC_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or
                    KeyProperties.PURPOSE_DECRYPT
            )
                .setKeySize(2048)
                .setEncryptionPaddings(
                    KeyProperties.ENCRYPTION_PADDING_RSA_OAEP
                )
                .setDigests(
                    KeyProperties.DIGEST_SHA256,
                    KeyProperties.DIGEST_SHA1
                )
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG
            )
        } else {
            // Require a biometric authentication for every use.
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        generator.initialize(builder.build())
        generator.generateKeyPair()
    }

    private fun biometricOaepSpec(): OAEPParameterSpec {
        return OAEPParameterSpec(
            "SHA-256",
            "MGF1",
            MGF1ParameterSpec.SHA1,
            PSource.PSpecified.DEFAULT
        )
    }

    private fun clearBiometricPinMaterial() {
        prefs.edit()
            .remove(KEY_BIOMETRIC_PIN_CIPHERTEXT)
            .apply()

        try {
            val keyStore = loadAndroidKeyStore()

            if (
                keyStore.containsAlias(
                    BIOMETRIC_KEY_ALIAS
                )
            ) {
                keyStore.deleteEntry(
                    BIOMETRIC_KEY_ALIAS
                )
            }
        } catch (_: Exception) {
            // Best effort cleanup.
        }
    }

    private fun loadAndroidKeyStore(): KeyStore {
        return KeyStore.getInstance(
            ANDROID_KEYSTORE
        ).apply {
            load(null)
        }
    }

    private fun generateSalt(
        size: Int = 16
    ): ByteArray {
        val salt = ByteArray(size)
        SecureRandom().nextBytes(salt)
        return salt
    }

    private fun hashPin(
        pin: String,
        salt: ByteArray
    ): ByteArray {
        val spec = PBEKeySpec(
            pin.toCharArray(),
            salt,
            PBKDF2_ITERATIONS,
            KEY_LENGTH_BITS
        )

        val factory =
            SecretKeyFactory.getInstance(
                PBKDF2_ALGORITHM
            )

        return factory
            .generateSecret(spec)
            .encoded
    }

    private fun ByteArray.toHex(): String =
        joinToString("") {
            "%02x".format(it)
        }

    private fun String.hexToBytes(): ByteArray {
        val clean = trim()
        val result =
            ByteArray(clean.length / 2)

        var i = 0

        while (i < clean.length) {
            val byte =
                clean.substring(
                    i,
                    i + 2
                ).toInt(16)

            result[i / 2] =
                byte.toByte()

            i += 2
        }

        return result
    }

    companion object {
        private const val PREF_NAME =
            "jeezpay_secure_session"

        private const val KEY_TOKEN =
            "token"

        private const val KEY_PHONE =
            "phone"

        private const val KEY_PIN_HASH =
            "pin_hash"

        private const val KEY_PIN_SALT =
            "pin_salt"

        private const val KEY_LEGACY_PIN =
            "pin"

        private const val KEY_PIN_FAILED_ATTEMPTS =
            "pin_failed_attempts"

        private const val KEY_PIN_LOCK_UNTIL =
            "pin_lock_until"

        private const val KEY_BIOMETRIC_ENABLED =
            "biometric_enabled"

        private const val KEY_BIOMETRIC_PIN_CIPHERTEXT =
            "biometric_pin_ciphertext"

        private const val ANDROID_KEYSTORE =
            "AndroidKeyStore"

        private const val BIOMETRIC_KEY_ALIAS =
            "jeezpay_transaction_biometric_v1"

        private const val BIOMETRIC_CIPHER_TRANSFORMATION =
            "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"

        private const val PBKDF2_ALGORITHM =
            "PBKDF2WithHmacSHA256"

        private const val PBKDF2_ITERATIONS =
            120_000

        private const val KEY_LENGTH_BITS =
            256

        const val MAX_PIN_ATTEMPTS =
            5

        const val PIN_LOCK_DURATION_MS =
            60_000L
    }
}