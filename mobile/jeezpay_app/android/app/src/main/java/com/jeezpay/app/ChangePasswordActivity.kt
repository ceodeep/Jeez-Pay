package com.jeezpay.app

import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.ImageView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.repository.AuthRepository
import kotlinx.coroutines.launch

class ChangePasswordActivity : AppCompatActivity() {

    private val repo = AuthRepository()

    private lateinit var btnBack: ImageView
    private lateinit var etCurrentPassword: EditText
    private lateinit var etNewPassword: EditText
    private lateinit var etConfirmPassword: EditText
    private lateinit var btnSavePassword: MaterialButton

    private var currentVisible = false
    private var newVisible = false
    private var confirmVisible = false

    private lateinit var ivCurrentEye: ImageView
    private lateinit var ivNewEye: ImageView
    private lateinit var ivConfirmEye: ImageView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_change_password)

        btnBack = findViewById(R.id.btnBack)
        etCurrentPassword = findViewById(R.id.etCurrentPassword)
        etNewPassword = findViewById(R.id.etNewPassword)
        etConfirmPassword = findViewById(R.id.etConfirmPassword)
        btnSavePassword = findViewById(R.id.btnSavePassword)

        ivCurrentEye = findViewById(R.id.ivCurrentEye)
        ivNewEye = findViewById(R.id.ivNewEye)
        ivConfirmEye = findViewById(R.id.ivConfirmEye)

        btnBack.setOnClickListener { finish() }

        ivCurrentEye.setOnClickListener {
            currentVisible = !currentVisible
            togglePasswordVisibility(etCurrentPassword, currentVisible)
        }

        ivNewEye.setOnClickListener {
            newVisible = !newVisible
            togglePasswordVisibility(etNewPassword, newVisible)
        }

        ivConfirmEye.setOnClickListener {
            confirmVisible = !confirmVisible
            togglePasswordVisibility(etConfirmPassword, confirmVisible)
        }

        btnSavePassword.setOnClickListener {
            validateAndSubmit()
        }
    }

    private fun validateAndSubmit() {
        val current = etCurrentPassword.text.toString().trim()
        val newPassword = etNewPassword.text.toString().trim()
        val confirm = etConfirmPassword.text.toString().trim()

        if (current.isBlank()) {
            toast("Enter your current password")
            return
        }

        if (newPassword.length < 8) {
            toast("New password must be at least 8 characters")
            return
        }

        if (newPassword != confirm) {
            toast("Passwords do not match")
            return
        }

        if (current == newPassword) {
            toast("New password must be different")
            return
        }

        changePassword(current, newPassword)
    }

    private fun changePassword(currentPassword: String, newPassword: String) {
        setLoading(true)

        lifecycleScope.launch {
            when (
                val result = repo.changePasswordSafe(
                    currentPassword = currentPassword,
                    newPassword = newPassword
                )
            ) {
                is ApiResult.Success -> {
                    setLoading(false)
                    toast(result.data.message.ifBlank { "Password changed successfully" })
                    finish()
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    toast(errorMessage(result.error))
                }
            }
        }
    }

    private fun togglePasswordVisibility(input: EditText, visible: Boolean) {
        input.inputType =
            if (visible) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }

        input.setSelection(input.text?.length ?: 0)
    }

    private fun setLoading(loading: Boolean) {
        btnSavePassword.isEnabled = !loading
        btnSavePassword.alpha = if (loading) 0.7f else 1f
        btnSavePassword.text = if (loading) "Saving..." else "Save Password"
    }

    private fun errorMessage(error: AppError): String {
        return when (error) {
            is AppError.NoInternet -> "No internet connection"
            is AppError.Server -> error.message
            is AppError.Unauthorized -> error.message
            is AppError.Validation -> error.message
            is AppError.Unknown -> error.message
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}