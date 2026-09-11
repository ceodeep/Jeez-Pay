package com.jeezpay.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.jeezpay.app.storage.SessionManager

class PinVerifyActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SUBTITLE = "extra_subtitle"
        const val RESULT_PIN = "result_pin"
    }

    private val pin = StringBuilder()

    private lateinit var sessionManager: SessionManager

    private lateinit var dot1: ImageView
    private lateinit var dot2: ImageView
    private lateinit var dot3: ImageView
    private lateinit var dot4: ImageView

    private lateinit var ivFinger: ImageView
    private lateinit var tvBiometricHint: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.JeezPayTheme)
        super.onCreate(savedInstanceState)

        setContentView(R.layout.activity_pin_verify)

        sessionManager = SessionManager(this)

        val tvHeader =
            findViewById<TextView>(R.id.tvHeader)

        val tvTitle =
            findViewById<TextView>(R.id.tvTitle)

        val tvSubTitle =
            findViewById<TextView>(R.id.tvSubTitle)

        val ivBack =
            findViewById<ImageView>(R.id.ivBack)

        ivFinger =
            findViewById(R.id.ivFinger)
        tvBiometricHint = findViewById(R.id.tvBiometricHint)

        // The small header is fixed.
        // EXTRA_TITLE belongs to the large action title.
        tvHeader.text =
            "Transaction verification"

        tvTitle.text =
            intent.getStringExtra(EXTRA_TITLE)
                ?.trim()
                ?.takeIf { it.isNotBlank() }
                ?: "Confirm transaction"

        tvSubTitle.text =
            intent.getStringExtra(EXTRA_SUBTITLE)
                ?.trim()
                ?.takeIf { it.isNotBlank() }
                ?: "Enter your 4-digit transaction PIN or use fingerprint."

        ivBack.setOnClickListener {
            finish()
        }

        dot1 = findViewById(R.id.dot1)
        dot2 = findViewById(R.id.dot2)
        dot3 = findViewById(R.id.dot3)
        dot4 = findViewById(R.id.dot4)

        bindDigit(R.id.key1, 1)
        bindDigit(R.id.key2, 2)
        bindDigit(R.id.key3, 3)
        bindDigit(R.id.key4, 4)
        bindDigit(R.id.key5, 5)
        bindDigit(R.id.key6, 6)
        bindDigit(R.id.key7, 7)
        bindDigit(R.id.key8, 8)
        bindDigit(R.id.key9, 9)
        bindDigit(R.id.key0, 0)

        findViewById<View>(R.id.btnBackspace)
            .setOnClickListener {
                onBackspace()
            }

        ivFinger.setOnClickListener {
            startBiometricApproval()
        }

        if (!sessionManager.hasPin()) {
            Toast.makeText(
                this,
                "No transaction PIN set. Please set a PIN first.",
                Toast.LENGTH_LONG
            ).show()

            finish()
            return
        }

        checkLockedState()
        updateDots()
        updateBiometricUi()
    }

    private fun bindDigit(
        viewId: Int,
        digit: Int
    ) {
        findViewById<View>(viewId)
            .setOnClickListener {

                if (sessionManager.isPinLocked()) {
                    showLockedMessage()
                    return@setOnClickListener
                }

                onDigit(digit)
            }
    }

    private fun onDigit(digit: Int) {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            return
        }

        if (pin.length >= 4) return

        pin.append(digit)
        updateDots()

        // No redundant Confirm button.
        // The fourth digit triggers verification.
        if (pin.length == 4) {
            verifyOrReject()
        }
    }

    private fun onBackspace() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            return
        }

        if (pin.isNotEmpty()) {
            pin.deleteCharAt(
                pin.length - 1
            )

            updateDots()
        }
    }

    private fun verifyOrReject() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            clearPin()
            return
        }

        val entered =
            pin.toString()

        if (!sessionManager.hasPin()) {
            Toast.makeText(
                this,
                "No transaction PIN set for this account.",
                Toast.LENGTH_SHORT
            ).show()

            clearPin()
            finish()
            return
        }

        val verified =
            sessionManager.verifyPin(entered)

        if (!verified) {
            val attempts =
                sessionManager
                    .incrementFailedPinAttempts()

            if (
                attempts >=
                SessionManager.MAX_PIN_ATTEMPTS
            ) {
                sessionManager.lockPinForMillis(
                    SessionManager.PIN_LOCK_DURATION_MS
                )

                Toast.makeText(
                    this,
                    "Too many attempts. Locked for 60 seconds.",
                    Toast.LENGTH_SHORT
                ).show()
            } else {
                val remaining =
                    SessionManager.MAX_PIN_ATTEMPTS -
                        attempts

                Toast.makeText(
                    this,
                    "Wrong PIN. $remaining attempt(s) left.",
                    Toast.LENGTH_SHORT
                ).show()
            }

            clearPin()
            return
        }

        sessionManager.resetFailedPinAttempts()

        // First-time biometric payment enrollment:
        // the user has already enabled biometrics AND just
        // successfully supplied the real transaction PIN.
        if (
            sessionManager.isBiometricEnabled() &&
            !sessionManager.hasBiometricPinCredential()
        ) {
            val provisioned =
                sessionManager
                    .provisionBiometricPin(entered)

            if (provisioned) {
                Toast.makeText(
                    this,
                    "Fingerprint payments are ready for next time.",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

        finishWithPin(entered)
    }

    private fun startBiometricApproval() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            return
        }

        if (!sessionManager.isBiometricEnabled()) {
            Toast.makeText(
                this,
                "Enable biometric authentication in Security first.",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        val manager =
            BiometricManager.from(this)

        when (
            manager.canAuthenticate(
                BiometricManager
                    .Authenticators
                    .BIOMETRIC_STRONG
            )
        ) {
            BiometricManager.BIOMETRIC_SUCCESS -> {
                // Continue.
            }

            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> {
                Toast.makeText(
                    this,
                    "No strong fingerprint or biometric is enrolled on this device.",
                    Toast.LENGTH_LONG
                ).show()

                return
            }

            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> {
                Toast.makeText(
                    this,
                    "This device does not support strong biometric authentication.",
                    Toast.LENGTH_LONG
                ).show()

                return
            }

            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> {
                Toast.makeText(
                    this,
                    "Biometric hardware is currently unavailable.",
                    Toast.LENGTH_LONG
                ).show()

                return
            }

            else -> {
                Toast.makeText(
                    this,
                    "Fingerprint authentication is unavailable.",
                    Toast.LENGTH_LONG
                ).show()

                return
            }
        }

        if (
            !sessionManager
                .hasBiometricPinCredential()
        ) {
            Toast.makeText(
                this,
                "Enter your transaction PIN once. Fingerprint payments will then be ready for future payments.",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        val cipher =
            sessionManager
                .createBiometricPinDecryptCipher()

        if (cipher == null) {
            sessionManager
                .invalidateBiometricPinCredential()

            updateBiometricUi()

            Toast.makeText(
                this,
                "Fingerprint payment needs to be set up again. Enter your PIN once.",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        val executor =
            ContextCompat.getMainExecutor(this)

        val prompt =
            BiometricPrompt(
                this,
                executor,
                object :
                    BiometricPrompt
                        .AuthenticationCallback() {

                    override fun onAuthenticationSucceeded(
                        result:
                            BiometricPrompt.AuthenticationResult
                    ) {
                        super
                            .onAuthenticationSucceeded(result)

                        val authenticatedCipher =
                            result.cryptoObject?.cipher

                        if (authenticatedCipher == null) {
                            biometricFailure()
                            return
                        }

                        val recoveredPin =
                            sessionManager
                                .decryptBiometricPin(
                                    authenticatedCipher
                                )

                        if (
                            recoveredPin.isNullOrBlank() ||
                            !sessionManager
                                .verifyPin(recoveredPin)
                        ) {
                            sessionManager
                                .invalidateBiometricPinCredential()

                            updateBiometricUi()

                            Toast.makeText(
                                this@PinVerifyActivity,
                                "Fingerprint payment needs to be set up again. Enter your PIN once.",
                                Toast.LENGTH_LONG
                            ).show()

                            return
                        }

                        sessionManager
                            .resetFailedPinAttempts()

                        finishWithPin(
                            recoveredPin
                        )
                    }

                    override fun onAuthenticationFailed() {
                        super.onAuthenticationFailed()

                        Toast.makeText(
                            this@PinVerifyActivity,
                            "Fingerprint not recognized.",
                            Toast.LENGTH_SHORT
                        ).show()
                    }

                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence
                    ) {
                        super.onAuthenticationError(
                            errorCode,
                            errString
                        )

                        if (
                            errorCode ==
                                BiometricPrompt.ERROR_USER_CANCELED ||
                            errorCode ==
                                BiometricPrompt.ERROR_CANCELED ||
                            errorCode ==
                                BiometricPrompt.ERROR_NEGATIVE_BUTTON
                        ) {
                            return
                        }

                        Toast.makeText(
                            this@PinVerifyActivity,
                            errString,
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            )

        val promptInfo =
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(
                    "Confirm with fingerprint"
                )
                .setSubtitle(
                    "Authorize this transaction using your fingerprint."
                )
                .setAllowedAuthenticators(
                    BiometricManager
                        .Authenticators
                        .BIOMETRIC_STRONG
                )
                .setNegativeButtonText(
                    "Use PIN"
                )
                .build()

        prompt.authenticate(
            promptInfo,
            BiometricPrompt.CryptoObject(
                cipher
            )
        )
    }

    private fun biometricFailure() {
        Toast.makeText(
            this,
            "Fingerprint authorization failed. Use your transaction PIN.",
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun updateBiometricUi() {
        val strongAvailable =
            BiometricManager
                .from(this)
                .canAuthenticate(
                    BiometricManager
                        .Authenticators
                        .BIOMETRIC_STRONG
                ) ==
                BiometricManager.BIOMETRIC_SUCCESS

        val enabled =
            sessionManager
                .isBiometricEnabled()

        val provisioned =
            sessionManager
                .hasBiometricPinCredential()

        ivFinger.alpha =
            when {
                !strongAvailable ->
                    0.30f

                !enabled ->
                    0.35f

                !provisioned ->
                    0.65f

                else ->
                    1f
            }

        // When hardware exists, keep it clickable so the screen can
        // explain how to enable/setup biometric payments.
        ivFinger.isEnabled =
            strongAvailable

        tvBiometricHint.text =
            when {
                !strongAvailable ->
                    "Enter your 4-digit transaction PIN to continue."

                !enabled ->
                    "Biometric payments are off. Enter your PIN or enable them in Security."

                !provisioned ->
                    "Enter your PIN once to finish setting up fingerprint payments."

                else ->
                    "Enter your PIN or tap the fingerprint to approve."
            }

        tvBiometricHint.setTextColor(
            getColor(
                if (
                    strongAvailable &&
                    enabled &&
                    provisioned
                ) {
                    R.color.paypal_blue
                } else {
                    R.color.text_secondary
                }
            )
        )

        ivFinger.contentDescription =
            when {
                !strongAvailable ->
                    "Fingerprint unavailable"

                !enabled ->
                    "Enable fingerprint payments"

                !provisioned ->
                    "Set up fingerprint payments"

                else ->
                    "Pay with fingerprint"
            }
    }
    private fun checkLockedState() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
        }
    }

    private fun showLockedMessage() {
        val seconds =
            (
                sessionManager
                    .getPinLockRemainingMillis() /
                    1000L
            ).coerceAtLeast(1L)

        Toast.makeText(
            this,
            "Too many failed attempts. Try again in ${seconds}s.",
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun clearPin() {
        pin.clear()
        updateDots()
    }

    private fun updateDots() {
        val len = pin.length

        dot1.setImageResource(
            if (len >= 1)
                R.drawable.ic_pin_dot_filled
            else
                R.drawable.ic_pin_dot_empty
        )

        dot2.setImageResource(
            if (len >= 2)
                R.drawable.ic_pin_dot_filled
            else
                R.drawable.ic_pin_dot_empty
        )

        dot3.setImageResource(
            if (len >= 3)
                R.drawable.ic_pin_dot_filled
            else
                R.drawable.ic_pin_dot_empty
        )

        dot4.setImageResource(
            if (len >= 4)
                R.drawable.ic_pin_dot_filled
            else
                R.drawable.ic_pin_dot_empty
        )
    }

    private fun finishWithPin(pin: String) {
        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(
                RESULT_PIN,
                pin
            )
        )

        finish()
    }
}