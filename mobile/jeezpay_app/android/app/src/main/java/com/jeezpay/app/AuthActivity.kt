package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.EditText
import android.widget.LinearLayout
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

    private lateinit var flipper: ViewFlipper

    private lateinit var etPhone: EditText
    private lateinit var btnContinue: MaterialButton
    private lateinit var actCountryCode: AutoCompleteTextView
    private lateinit var createAccountRow: LinearLayout
    private lateinit var tvForgotPassword: TextView
    private lateinit var passwordBox: LinearLayout

    private lateinit var btnBackOtp: TextView
    private lateinit var tvOtpHint: TextView
    private lateinit var etOtp: EditText
    private lateinit var btnVerify: MaterialButton

    private lateinit var btnBackPin: TextView
    private lateinit var etPin: EditText
    private lateinit var btnSetPin: MaterialButton

    private lateinit var btnUseAnotherAccount: TextView
    private lateinit var btnUnlock: MaterialButton

    private val countryCodes = listOf(
        "Sudan (+249)",
        "South Sudan (+211)",
        "Uganda (+256)",
        "Egypt (+20)"
    )

    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    onPinEntered(pin)
                }
            }
        }

    private enum class PinAction { VERIFY_LOGIN }
    private var pendingPinAction: PinAction = PinAction.VERIFY_LOGIN

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_auth)

        session = SessionManager(this)

        bindViews()
        setupCountryCodeDropdown()
        routeUser()

        setupPhoneScreen()
        setupOtpScreen()
        setupPinSetScreen()
        setupUnlockScreen()
        setupExtraClicks()
    }

    private fun bindViews() {
        flipper = findViewById(R.id.authFlipper)

        etPhone = findViewById(R.id.etPhone)
        btnContinue = findViewById(R.id.btnContinue)
        actCountryCode = findViewById(R.id.actCountryCode)
        createAccountRow = findViewById(R.id.createAccountRow)
        tvForgotPassword = findViewById(R.id.tvForgotPassword)
        passwordBox = findViewById(R.id.passwordBox)

        btnBackOtp = findViewById(R.id.btnBackOtp)
        tvOtpHint = findViewById(R.id.tvOtpHint)
        etOtp = findViewById(R.id.etOtp)
        btnVerify = findViewById(R.id.btnVerify)

        btnBackPin = findViewById(R.id.btnBackPin)
        etPin = findViewById(R.id.etPin)
        btnSetPin = findViewById(R.id.btnSetPin)

        btnUseAnotherAccount = findViewById(R.id.btnUseAnotherAccount)
        btnUnlock = findViewById(R.id.btnUnlock)
    }

    private fun setupCountryCodeDropdown() {
        val adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, countryCodes)
        actCountryCode.setAdapter(adapter)
        actCountryCode.setText("Sudan (+249)", false)

        actCountryCode.setOnClickListener {
            actCountryCode.showDropDown()
        }
    }

    private fun setupExtraClicks() {
        passwordBox.setOnClickListener {
            Toast.makeText(this, "Password login is not enabled yet. Please use OTP.", Toast.LENGTH_SHORT).show()
        }

        tvForgotPassword.setOnClickListener {
            Toast.makeText(this, "Password reset is not enabled yet. Please use OTP login.", Toast.LENGTH_SHORT).show()
        }

        createAccountRow.setOnClickListener {
            Toast.makeText(this, "Use your phone number and OTP to create a new account.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun buildFullPhone(): String {
        val selected = actCountryCode.text.toString().trim()
        val code = selected.substringAfter("(").substringBefore(")").ifBlank { selected }

        var local = etPhone.text.toString().trim()
        local = local.replace("\\s".toRegex(), "")

        if (local.startsWith("0")) {
            local = local.substring(1)
        }
        if (local.startsWith("+")) {
            return local
        }

        return code + local
    }

    private fun routeUser() {
        val token = session.getToken()

        if (token.isNullOrBlank()) {
            flipper.displayedChild = 0
            return
        }

        flipper.displayedChild = 3
    }

    private fun setupPhoneScreen() {
        btnContinue.isEnabled = false
        etPhone.addTextChangedListener(SimpleTextWatcher {
            btnContinue.isEnabled = etPhone.text.toString().trim().length >= 6
        })

        btnContinue.setOnClickListener {
            val fullPhone = buildFullPhone()
            requestOtp(fullPhone) {
                flipper.displayedChild = 1
                tvOtpHint.text = "Enter the code sent to $fullPhone"
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
            val fullPhone = buildFullPhone()
            val otp = etOtp.text.toString().trim()

            verifyOtp(fullPhone, otp) { token, isNewUser ->
                session.saveToken(token)
                session.savePhone(fullPhone)

                if (isNewUser) {
                    flipper.displayedChild = 2
                } else {
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
            PinAction.VERIFY_LOGIN -> verifyPinOnBackend(pin)
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
                    Toast.makeText(this@AuthActivity, "Request OTP failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun verifyOtp(
        phone: String,
        otp: String,
        onSuccess: (token: String, isNewUser: Boolean) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.verifyOtp(phone, otp)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token, res.isNewUser)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Verify failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun setPinOnBackend(pin: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                repo.setPin(pin)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "PIN set successfully", Toast.LENGTH_SHORT).show()
                    openMain()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Set PIN failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun verifyPinOnBackend(pin: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.verifyPin(pin)
                withContext(Dispatchers.Main) {
                    if (!res.ok) {
                        Toast.makeText(
                            this@AuthActivity,
                            res.message ?: "Wrong PIN",
                            Toast.LENGTH_SHORT
                        ).show()
                        return@withContext
                    }
                    openMain()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "PIN verify failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun openMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}