package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import android.widget.ViewFlipper
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.repository.AuthRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AuthActivity : AppCompatActivity() {

    private lateinit var session: SessionManager
    private val repo = AuthRepository()

    // Views
    private lateinit var flipper: android.widget.ViewFlipper

    private lateinit var etPhone: EditText
    private lateinit var btnContinue: MaterialButton

    private lateinit var btnBackOtp: TextView
    private lateinit var tvOtpHint: TextView
    private lateinit var etOtp: EditText
    private lateinit var btnVerify: MaterialButton

    private lateinit var btnBackPin: TextView
    private lateinit var etPin: EditText
    private lateinit var btnSetPin: MaterialButton

    // PIN unlock screen (child index 3)
    private lateinit var etUnlockPin: EditText
    private lateinit var btnUnlock: MaterialButton
    private lateinit var btnUseAnotherAccount: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_auth)

        session = SessionManager(this)

        // ✅ Bind views first (IMPORTANT)
        bindViews()

        // ✅ Decide which screen to show first
        routeUser()

        // ✅ Setup listeners (they’ll work for whichever screen is shown)
        setupPhoneScreen()
        setupOtpScreen()
        setupPinSetScreen()
        setupPinUnlockScreen()
    }

    private fun bindViews() {
        flipper = findViewById(R.id.authFlipper)

        etPhone = findViewById(R.id.etPhone)
        btnContinue = findViewById(R.id.btnContinue)

        btnBackOtp = findViewById(R.id.btnBackOtp)
        tvOtpHint = findViewById(R.id.tvOtpHint)
        etOtp = findViewById(R.id.etOtp)
        btnVerify = findViewById(R.id.btnVerify)

        btnBackPin = findViewById(R.id.btnBackPin)
        etPin = findViewById(R.id.etPin)
        btnSetPin = findViewById(R.id.btnSetPin)

        // These MUST exist in activity_auth.xml (screen 3)
        etUnlockPin = findViewById(R.id.etUnlockPin)
        btnUnlock = findViewById(R.id.btnUnlock)
        btnUseAnotherAccount = findViewById(R.id.btnUseAnotherAccount)
    }

    private fun routeUser() {
        val token = session.getToken()
        val pin = session.getPin()

        // 1) no token -> phone login screen
        if (token.isNullOrBlank()) {
            flipper.displayedChild = 0
            return
        }

        // 2) token exists but no pin -> set pin screen
        if (pin.isNullOrBlank()) {
            flipper.displayedChild = 2
            return
        }

        // 3) token + pin -> unlock pin screen
        flipper.displayedChild = 3
    }

    private fun setupPhoneScreen() {
        btnContinue.isEnabled = false
        etPhone.addTextChangedListener(SimpleTextWatcher {
            btnContinue.isEnabled = etPhone.text.toString().trim().length >= 8
        })

        btnContinue.setOnClickListener {
            val phone = etPhone.text.toString().trim()

            requestOtp(phone) {
                flipper.displayedChild = 1
                tvOtpHint.text = "Enter the code sent to your phone"
            }
        }
    }

    private fun setupOtpScreen() {
        btnVerify.isEnabled = false
        etOtp.addTextChangedListener(SimpleTextWatcher {
            btnVerify.isEnabled = etOtp.text.toString().trim().length == 6
        })

        btnBackOtp.setOnClickListener {
            flipper.displayedChild = 0
        }

        btnVerify.setOnClickListener {
            val phone = etPhone.text.toString().trim()
            val otp = etOtp.text.toString().trim()

            verifyOtp(phone, otp) { token ->
                session.saveToken(token)
                flipper.displayedChild = 2
            }
        }
    }

    private fun setupPinSetScreen() {
        btnSetPin.isEnabled = false
        etPin.addTextChangedListener(SimpleTextWatcher {
            btnSetPin.isEnabled = etPin.text.toString().trim().length == 4
        })

        btnBackPin.setOnClickListener {
            flipper.displayedChild = 1
        }

        btnSetPin.setOnClickListener {
            val pin = etPin.text.toString().trim()

            if (pin.length != 4) {
                Toast.makeText(this, "PIN must be 4 digits", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            session.savePin(pin)
            openMain()
        }
    }

    private fun setupPinUnlockScreen() {
        btnUnlock.isEnabled = false
        etUnlockPin.addTextChangedListener(SimpleTextWatcher {
            btnUnlock.isEnabled = etUnlockPin.text.toString().trim().length == 4
        })

        btnUnlock.setOnClickListener {
            val typed = etUnlockPin.text.toString().trim()
            val saved = session.getPin()

            if (saved.isNullOrBlank()) {
                // Shouldn’t happen, but safe fallback
                flipper.displayedChild = 2
                return@setOnClickListener
            }

            if (typed != saved) {
                Toast.makeText(this, "Wrong PIN", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            openMain()
        }

        btnUseAnotherAccount.setOnClickListener {
            session.clearAll()
            flipper.displayedChild = 0
        }
    }

    private fun requestOtp(phone: String, onSuccess: () -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.requestOtp(phone)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "Request OTP failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun verifyOtp(phone: String, otp: String, onSuccess: (String) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.verifyOtp(phone, otp)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "Verify failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun openMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
