package com.jeezpay.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.jeezpay.app.databinding.ActivitySecurityBinding
import com.jeezpay.app.storage.SessionManager

class SecurityActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySecurityBinding
    private lateinit var session: SessionManager

    private var suppressBiometricSwitchCallback = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySecurityBinding.inflate(layoutInflater)
        setContentView(binding.root)

        session = SessionManager(this)

        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.tvCurrentDevice.text = buildDeviceLabel()

        suppressBiometricSwitchCallback = true
        binding.switchBiometric.isChecked = session.isBiometricEnabled()
        suppressBiometricSwitchCallback = false

        binding.rowChangePin.setOnClickListener {
            startActivity(Intent(this, ChangePinActivity::class.java))
        }

        binding.rowChangePassword.setOnClickListener {
            startActivity(Intent(this, ChangePasswordActivity::class.java))
        }

        binding.switchBiometric.setOnCheckedChangeListener { _, isChecked ->
            if (suppressBiometricSwitchCallback) return@setOnCheckedChangeListener

            if (isChecked) {
                enableBiometric()
            } else {
                session.setBiometricEnabled(false)
                toast("Biometric unlock disabled")
            }
        }

        binding.rowBiometric.setOnClickListener {
            binding.switchBiometric.isChecked = !binding.switchBiometric.isChecked
        }

        binding.switchRequirePinTransfers.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                toast("PIN will be required before transfers")
            } else {
                toast("PIN protection for transfers disabled locally")
            }
        }

        binding.rowForgotPinRecovery.setOnClickListener {
            toast("PIN recovery is available from the login screen")
        }

        binding.rowActiveSessions.setOnClickListener {
            startActivity(Intent(this, ActiveSessionsActivity::class.java))
        }
    }

    private fun enableBiometric() {
        val authenticators =
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL

        val manager = BiometricManager.from(this)

        when (manager.canAuthenticate(authenticators)) {
            BiometricManager.BIOMETRIC_SUCCESS -> {
                showBiometricPrompt()
            }

            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> {
                resetBiometricSwitch()
                toast("This device does not support biometric unlock")
            }

            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> {
                resetBiometricSwitch()
                toast("Biometric hardware is currently unavailable")
            }

            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> {
                resetBiometricSwitch()
                toast("No fingerprint, face unlock, or device lock is set up")
            }

            else -> {
                resetBiometricSwitch()
                toast("Biometric unlock is not available on this device")
            }
        }
    }

    private fun showBiometricPrompt() {
        val executor = ContextCompat.getMainExecutor(this)

        val prompt = BiometricPrompt(
            this,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult
                ) {
                    super.onAuthenticationSucceeded(result)

                    session.setBiometricEnabled(true)

                    suppressBiometricSwitchCallback = true
                    binding.switchBiometric.isChecked = true
                    suppressBiometricSwitchCallback = false

                    toast("Biometric unlock enabled")
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    errString: CharSequence
                ) {
                    super.onAuthenticationError(errorCode, errString)

                    resetBiometricSwitch()

                    if (errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                        errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                        errorCode != BiometricPrompt.ERROR_CANCELED
                    ) {
                        toast(errString.toString())
                    }
                }

                override fun onAuthenticationFailed() {
                    super.onAuthenticationFailed()
                    toast("Biometric authentication failed")
                }
            }
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Enable biometric unlock")
            .setSubtitle("Use fingerprint, face unlock, or your device lock to access JeezPay faster.")
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()

        prompt.authenticate(promptInfo)
    }

    private fun resetBiometricSwitch() {
        session.setBiometricEnabled(false)

        suppressBiometricSwitchCallback = true
        binding.switchBiometric.isChecked = false
        suppressBiometricSwitchCallback = false
    }

    private fun buildDeviceLabel(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().replaceFirstChar {
            if (it.isLowerCase()) it.titlecase() else it.toString()
        }

        val model = Build.MODEL.orEmpty()

        return when {
            manufacturer.isBlank() && model.isBlank() -> "This Android device"
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}