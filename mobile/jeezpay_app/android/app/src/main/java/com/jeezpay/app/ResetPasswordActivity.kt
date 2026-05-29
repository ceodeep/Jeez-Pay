package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.repository.AuthRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ResetPasswordActivity : BaseFintechActivity() {

    private lateinit var session: SessionManager
    private val repo by lazy { AuthRepository() }

    private lateinit var etNewPassword: EditText
    private lateinit var etConfirmPassword: EditText
    private lateinit var btnResetPassword: MaterialButton
    private lateinit var btnBack: TextView
    private lateinit var ivEyeNew: ImageView
    private lateinit var ivEyeConfirm: ImageView

    private var newVisible = false
    private var confirmVisible = false

    private lateinit var identifier: String
    private lateinit var otp: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_reset_password)

        session = SessionManager(this)
        ApiClient.init(session)

        identifier = intent.getStringExtra("identifier") ?: ""
        otp = intent.getStringExtra("otp") ?: ""

        etNewPassword = findViewById(R.id.etNewPassword)
        etConfirmPassword = findViewById(R.id.etConfirmPassword)
        btnResetPassword = findViewById(R.id.btnResetPassword)
        btnBack = findViewById(R.id.btnBack)
        ivEyeNew = findViewById(R.id.ivEyeNew)
        ivEyeConfirm = findViewById(R.id.ivEyeConfirm)

        btnBack.setOnClickListener { finish() }

        ivEyeNew.setOnClickListener {
            newVisible = !newVisible
            togglePassword(etNewPassword, newVisible)
        }

        ivEyeConfirm.setOnClickListener {
            confirmVisible = !confirmVisible
            togglePassword(etConfirmPassword, confirmVisible)
        }

        btnResetPassword.setOnClickListener {
            resetPassword()
        }
    }

    private fun togglePassword(input: EditText, visible: Boolean) {
        input.inputType =
            if (visible) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }

        input.setSelection(input.text?.length ?: 0)
    }

    private fun resetPassword() {
        val newPassword = etNewPassword.text.toString().trim()
        val confirmPassword = etConfirmPassword.text.toString().trim()

        if (identifier.isBlank() || otp.isBlank()) {
            Toast.makeText(this, "Reset session expired. Please try again.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        if (newPassword.length < 8) {
            Toast.makeText(this, "Password must be at least 8 characters", Toast.LENGTH_SHORT).show()
            return
        }

        if (newPassword != confirmPassword) {
            Toast.makeText(this, "Passwords do not match", Toast.LENGTH_SHORT).show()
            return
        }

        btnResetPassword.isEnabled = false
        btnResetPassword.text = "Resetting..."

        CoroutineScope(Dispatchers.IO).launch {
            when (
                val result = repo.forgotPasswordVerifyOtpSafe(
                    identifier = identifier,
                    otp = otp,
                    newPassword = newPassword
                )
            ) {
                is ApiResult.Success -> {
                    val res = result.data

                    withContext(Dispatchers.Main) {
                        session.saveToken(res.token)
                        session.savePhone(identifier)

                        Toast.makeText(
                            this@ResetPasswordActivity,
                            res.message,
                            Toast.LENGTH_SHORT
                        ).show()

                        if (res.hasPin) {
                            startActivity(Intent(this@ResetPasswordActivity, AuthActivity::class.java))
                        } else {
                            startActivity(Intent(this@ResetPasswordActivity, AuthActivity::class.java))
                        }

                        finish()
                    }
                }

                is ApiResult.Error -> {
                    withContext(Dispatchers.Main) {
                        btnResetPassword.isEnabled = true
                        btnResetPassword.text = "Reset Password"
                        Toast.makeText(
                            this@ResetPasswordActivity,
                            "Failed to reset password",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        }
    }
}