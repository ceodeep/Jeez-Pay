package com.jeezpay.app

import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.repository.AuthRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.launch

class ChangeEmailActivity : BaseFintechActivity() {

    private val repo = AuthRepository()
    private lateinit var session: SessionManager

    private lateinit var btnBack: TextView
    private lateinit var etNewEmail: EditText
    private lateinit var etOtp: EditText
    private lateinit var btnSendOtp: MaterialButton
    private lateinit var btnVerifyEmail: MaterialButton

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_change_email)

        session = SessionManager(this)
        ApiClient.init(session)

        btnBack = findViewById(R.id.btnBack)
        etNewEmail = findViewById(R.id.etNewEmail)
        etOtp = findViewById(R.id.etOtp)
        btnSendOtp = findViewById(R.id.btnSendOtp)
        btnVerifyEmail = findViewById(R.id.btnVerifyEmail)

        btnBack.setOnClickListener { finish() }

        btnSendOtp.setOnClickListener {
            requestOtp()
        }

        btnVerifyEmail.setOnClickListener {
            verifyOtp()
        }
    }

    private fun requestOtp() {
        val newEmail = etNewEmail.text.toString().trim().lowercase()

        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(newEmail).matches()) {
            Toast.makeText(this, "Enter a valid email address", Toast.LENGTH_SHORT).show()
            return
        }

        btnSendOtp.isEnabled = false
        btnSendOtp.text = "Sending..."

        lifecycleScope.launch {
            when (val result = repo.changeEmailRequestOtpSafe(newEmail)) {
                is ApiResult.Success -> {
                    btnSendOtp.isEnabled = true
                    btnSendOtp.text = "Resend Code"
                    Toast.makeText(this@ChangeEmailActivity, result.data.message, Toast.LENGTH_SHORT).show()
                }

                is ApiResult.Error -> {
                    btnSendOtp.isEnabled = true
                    btnSendOtp.text = "Send Verification Code"
                    Toast.makeText(this@ChangeEmailActivity, "Failed to send code", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun verifyOtp() {
        val newEmail = etNewEmail.text.toString().trim().lowercase()
        val otp = etOtp.text.toString().trim()

        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(newEmail).matches()) {
            Toast.makeText(this, "Enter a valid email address", Toast.LENGTH_SHORT).show()
            return
        }

        if (otp.length != 6) {
            Toast.makeText(this, "Enter the 6-digit verification code", Toast.LENGTH_SHORT).show()
            return
        }

        btnVerifyEmail.isEnabled = false
        btnVerifyEmail.text = "Verifying..."

        lifecycleScope.launch {
            when (val result = repo.changeEmailVerifyOtpSafe(newEmail, otp)) {
                is ApiResult.Success -> {
                    Toast.makeText(this@ChangeEmailActivity, result.data.message, Toast.LENGTH_SHORT).show()
                    setResult(RESULT_OK)
                    finish()
                }

                is ApiResult.Error -> {
                    btnVerifyEmail.isEnabled = true
                    btnVerifyEmail.text = "Verify & Update Email"
                    Toast.makeText(this@ChangeEmailActivity, "Failed to change email", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}