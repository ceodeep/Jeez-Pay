package com.jeezpay.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.jeezpay.app.databinding.ActivitySecurityBinding

class SecurityActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySecurityBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySecurityBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.tvCurrentDevice.text = buildDeviceLabel()

        binding.rowChangePin.setOnClickListener {
            startActivity(Intent(this, ChangePinActivity::class.java))
        }

        binding.rowChangePassword.setOnClickListener {
            toast("Change password coming soon")
        }

        binding.switchBiometric.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                toast("Biometric unlock coming soon")
                binding.switchBiometric.isChecked = false
            }
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
            toast("Active sessions coming soon")
        }
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