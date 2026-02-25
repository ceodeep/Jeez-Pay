package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import android.widget.ViewFlipper
import androidx.activity.result.contract.ActivityResultContracts
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
    private lateinit var flipper: ViewFlipper

    // Screen 0
    private lateinit var etPhone: EditText
    private lateinit var btnContinue: MaterialButton

    // Screen 1
    private lateinit var btnBackOtp: TextView
    private lateinit var tvOtpHint: TextView
    private lateinit var etOtp: EditText
    private lateinit var btnVerify: MaterialButton

    // Screen 2 (Set PIN)
    private lateinit var btnBackPin: TextView
    private lateinit var etPin: EditText
    private lateinit var btnSetPin: MaterialButton

    // Screen 3 (Unlock)
    private lateinit var btnUseAnotherAccount: TextView
    private lateinit var btnUnlock: MaterialButton


    // ---- PIN verify launcher (uses your PinVerifyActivity keypad UI) ----
    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    onPinEntered(pin)
                }
            }
        }

    private enum class PinAction { VERIFY_LOGIN, SET_PIN }
    private var pendingPinAction: PinAction = PinAction.VERIFY_LOGIN

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_auth)

        session = SessionManager(this)

        bindViews()
        routeUser()

        setupPhoneScreen()
        setupOtpScreen()
        setupPinSetScreen()
        setupUnlockScreen()
    }

    private fun bindViews() {
        flipper = findViewById(R.id.authFlipper)

        // Screen 0
        etPhone = findViewById(R.id.etPhone)
        btnContinue = findViewById(R.id.btnContinue)

        // Screen 1
        btnBackOtp = findViewById(R.id.btnBackOtp)
        tvOtpHint = findViewById(R.id.tvOtpHint)
        etOtp = findViewById(R.id.etOtp)
        btnVerify = findViewById(R.id.btnVerify)


        // Screen 2
        btnBackPin = findViewById(R.id.btnBackPin)
        etPin = findViewById(R.id.etPin)
        btnSetPin = findViewById(R.id.btnSetPin)

        // Screen 3
        btnUseAnotherAccount = findViewById(R.id.btnUseAnotherAccount)
        btnUnlock = findViewById(R.id.btnUnlock)

        // ✅ Add this button in your XML for screen 3 (or reuse existing)
        // If you don't have it, create a MaterialButton with id btnUnlockWithPin

    }

    private fun routeUser() {
        val token = session.getToken()
        val savedPhone = session.getPhone()

        // 1) no token -> phone login screen
        if (token.isNullOrBlank()) {
            flipper.displayedChild = 0
            return
        }

        // token exists but phone missing -> force phone login once
        if (savedPhone.isNullOrBlank()) {
            flipper.displayedChild = 0
            return
        }

        // token exists -> go unlock screen
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

            verifyOtp(phone, otp) { token, isNewUser ->
                session.saveToken(token)
                session.savePhone(phone)

                if (isNewUser) {
                    // ✅ new user -> must set pin (backend)
                    flipper.displayedChild = 2
                } else {
                    // ✅ existing user -> unlock with pin
                    flipper.displayedChild = 3
                }
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

            // ✅ Send pin to backend to store securely (pin_hash)
            setPinOnBackend(pin)
        }
    }

    private fun setupUnlockScreen() {
        btnUnlock.setOnClickListener {
            pendingPinAction = PinAction.VERIFY_LOGIN
            openPinScreen(
                title = "Enter your PIN",
                subtitle = "Enter your PIN to unlock"
            )
        }

        btnUseAnotherAccount.setOnClickListener {
            session.clearAll()
            flipper.displayedChild = 0
        }
        android.util.Log.d("AUTH_DEBUG", "Unlock clicked")
    }

    private fun openPinScreen(title: String, subtitle: String) {
        val i = Intent(this, PinVerifyActivity::class.java).apply {
            putExtra(PinVerifyActivity.EXTRA_TITLE, title)
            putExtra(PinVerifyActivity.EXTRA_SUBTITLE, subtitle)
        }
        pinLauncher.launch(i)
    }

    private fun onPinEntered(pin: String) {
        when (pendingPinAction) {
            PinAction.VERIFY_LOGIN -> {
                verifyPinOnBackend(pin)
            }
            PinAction.SET_PIN -> {
                setPinOnBackend(pin)
            }
        }
    }

    // -------- NETWORK --------

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

    private fun verifyOtp(phone: String, otp: String, onSuccess: (token: String, isNewUser: Boolean) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.verifyOtp(phone, otp) // ✅ must return isNewUser
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token, res.isNewUser)
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

    private fun setPinOnBackend(pin: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                repo.setPin(pin) // ✅ implement in AuthRepository
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "PIN set successfully", Toast.LENGTH_SHORT).show()
                    flipper.displayedChild = 3
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "Set PIN failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun verifyPinOnBackend(pin: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val ok = repo.verifyPin(pin) // ✅ implement in AuthRepository returns Boolean
                withContext(Dispatchers.Main) {
                    if (!ok) {
                        Toast.makeText(this@AuthActivity, "Wrong PIN", Toast.LENGTH_SHORT).show()
                        return@withContext
                    }
                    openMain()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "PIN verify failed: ${e.message}",
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