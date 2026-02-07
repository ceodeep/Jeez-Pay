package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton

class AuthActivity : AppCompatActivity() {

    private val prefs by lazy { getSharedPreferences("jeezpay_prefs", MODE_PRIVATE) }

    private lateinit var flipper: android.widget.ViewFlipper

    // Screen 1
    private lateinit var etPhone: EditText
    private lateinit var btnContinue: MaterialButton

    // Screen 2
    private lateinit var tvOtpHint: TextView
    private lateinit var etOtp: EditText
    private lateinit var btnVerify: MaterialButton
    private lateinit var btnBackOtp: View

    // Screen 3
    private lateinit var etPin: EditText
    private lateinit var btnSetPin: MaterialButton
    private lateinit var btnBackPin: View

    private var phoneCache: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // If already logged in, skip auth
        if (prefs.getBoolean("logged_in", false)) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        setContentView(R.layout.activity_auth)

        bind()
        setupPhoneScreen()
        setupOtpScreen()
        setupPinScreen()
    }

    private fun bind() {
        flipper = findViewById(R.id.authFlipper)

        etPhone = findViewById(R.id.etPhone)
        btnContinue = findViewById(R.id.btnContinue)

        tvOtpHint = findViewById(R.id.tvOtpHint)
        etOtp = findViewById(R.id.etOtp)
        btnVerify = findViewById(R.id.btnVerify)
        btnBackOtp = findViewById(R.id.btnBackOtp)

        etPin = findViewById(R.id.etPin)
        btnSetPin = findViewById(R.id.btnSetPin)
        btnBackPin = findViewById(R.id.btnBackPin)
    }

    private fun setupPhoneScreen() {
        btnContinue.isEnabled = false

        etPhone.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val text = s?.toString()?.trim().orEmpty()
                btnContinue.isEnabled = text.length >= 8
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        btnContinue.setOnClickListener {
            phoneCache = etPhone.text.toString().trim()
            tvOtpHint.text = "Enter the code sent to $phoneCache"
            etOtp.setText("")
            flipper.displayedChild = 1
        }
    }

    private fun setupOtpScreen() {
        btnVerify.isEnabled = false

        etOtp.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val code = s?.toString()?.trim().orEmpty()
                btnVerify.isEnabled = code.length >= 4
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        btnBackOtp.setOnClickListener {
            flipper.displayedChild = 0
        }

        btnVerify.setOnClickListener {
            // MVP: OTP "logic-ready". We accept any 4+ digits.
            // In backend integration later, you will verify via API.

            // If PIN already exists -> login directly
            val pinSaved = prefs.getString("pin_code", null)
            if (pinSaved != null) {
                prefs.edit().putBoolean("logged_in", true).apply()
                goMain()
            } else {
                etPin.setText("")
                btnSetPin.isEnabled = false
                flipper.displayedChild = 2
            }
        }
    }

    private fun setupPinScreen() {
        btnSetPin.isEnabled = false

        etPin.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val pin = s?.toString()?.trim().orEmpty()
                btnSetPin.isEnabled = pin.length == 4
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        btnBackPin.setOnClickListener {
            flipper.displayedChild = 1
        }

        btnSetPin.setOnClickListener {
            val pin = etPin.text.toString().trim()
            if (pin.length == 4) {
                prefs.edit()
                    .putString("pin_code", pin)
                    .putBoolean("logged_in", true)
                    .apply()
                goMain()
            }
        }
    }

    private fun goMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
