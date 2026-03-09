package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.text.InputType
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
import com.google.android.material.dialog.MaterialAlertDialogBuilder
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

    // Login screen
    private lateinit var etPhone: EditText
    private lateinit var btnContinue: MaterialButton
    private lateinit var actCountryCode: AutoCompleteTextView
    private lateinit var createAccountRow: LinearLayout
    private lateinit var tvForgotPassword: TextView
    private lateinit var passwordBox: LinearLayout

    // OTP screen
    private lateinit var btnBackOtp: TextView
    private lateinit var tvOtpHint: TextView
    private lateinit var etOtp: EditText
    private lateinit var otpBox1: TextView
    private lateinit var otpBox2: TextView
    private lateinit var otpBox3: TextView
    private lateinit var otpBox4: TextView
    private lateinit var otpBox5: TextView
    private lateinit var otpBox6: TextView
    private lateinit var otpBoxesRow: LinearLayout
    private lateinit var btnVerify: MaterialButton

    // PIN set
    private lateinit var btnBackPin: TextView
    private lateinit var etPin: EditText
    private lateinit var btnSetPin: MaterialButton

    // Unlock
    private lateinit var btnUseAnotherAccount: TextView
    private lateinit var btnUnlock: MaterialButton

    // Create account
    private lateinit var actAccountType: AutoCompleteTextView
    private lateinit var actSignupCountryCode: AutoCompleteTextView
    private lateinit var etSignupPhone: EditText
    private lateinit var etSignupPassword: EditText
    private lateinit var etSignupConfirmPassword: EditText
    private lateinit var cbTerms: android.widget.CheckBox
    private lateinit var ivSignupEye1: android.widget.ImageView
    private lateinit var ivSignupEye2: android.widget.ImageView
    private lateinit var btnCreateAccount: MaterialButton
    private lateinit var loginInsteadRow: LinearLayout
    private lateinit var etLoginPassword: EditText
    private lateinit var ivLoginEye: android.widget.ImageView

    private val countryCodes = listOf("+249", "+211", "+256", "+20")



    private data class PendingSignup(
        val phone: String,
        val password: String,
        val accountType: String,
        val countryCode: String,
        val termsAccepted: Boolean
    )

    private var pendingSignup: PendingSignup? = null

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
        setupCreateAccountScreen()
    }

    private fun bindViews() {
        flipper = findViewById(R.id.authFlipper)

        etPhone = findViewById(R.id.etPhone)
        btnContinue = findViewById(R.id.btnContinue)
        actCountryCode = findViewById(R.id.actCountryCode)
        createAccountRow = findViewById(R.id.createAccountRow)
        tvForgotPassword = findViewById(R.id.tvForgotPassword)
        passwordBox = findViewById(R.id.passwordBox)

        otpBox1 = findViewById(R.id.otpBox1)
        otpBox2 = findViewById(R.id.otpBox2)
        otpBox3 = findViewById(R.id.otpBox3)
        otpBox4 = findViewById(R.id.otpBox4)
        otpBox5 = findViewById(R.id.otpBox5)
        otpBox6 = findViewById(R.id.otpBox6)
        otpBoxesRow = findViewById(R.id.otpBoxesRow)

        btnBackOtp = findViewById(R.id.btnBackOtp)
        tvOtpHint = findViewById(R.id.tvOtpHint)
        etOtp = findViewById(R.id.etOtp)
        btnVerify = findViewById(R.id.btnVerify)

        btnBackPin = findViewById(R.id.btnBackPin)
        etPin = findViewById(R.id.etPin)
        btnSetPin = findViewById(R.id.btnSetPin)

        btnUseAnotherAccount = findViewById(R.id.btnUseAnotherAccount)
        btnUnlock = findViewById(R.id.btnUnlock)

        actAccountType = findViewById(R.id.actAccountType)
        actSignupCountryCode = findViewById(R.id.actSignupCountryCode)
        etSignupPhone = findViewById(R.id.etSignupPhone)
        etSignupPassword = findViewById(R.id.etSignupPassword)
        etSignupConfirmPassword = findViewById(R.id.etSignupConfirmPassword)
        cbTerms = findViewById(R.id.cbTerms)
        btnCreateAccount = findViewById(R.id.btnCreateAccount)
        loginInsteadRow = findViewById(R.id.loginInsteadRow)
        ivSignupEye1 = findViewById(R.id.ivSignupEye1)
        ivSignupEye2 = findViewById(R.id.ivSignupEye2)

        etLoginPassword = findViewById(R.id.etLoginPassword)
        ivLoginEye = findViewById(R.id.ivLoginEye)
    }

    private fun setupCountryCodeDropdown() {
        val adapter = ArrayAdapter(this, R.layout.item_country_code, countryCodes)
        actCountryCode.setAdapter(adapter)
        actCountryCode.setText("+249", false)
        actCountryCode.dropDownWidth = 400

        actCountryCode.setOnClickListener {
            actCountryCode.showDropDown()
        }
    }

    private fun setupExtraClicks() {
        tvForgotPassword.setOnClickListener {
            Toast.makeText(this, "Forgot password flow is not added yet.", Toast.LENGTH_SHORT).show()
        }

        createAccountRow.setOnClickListener {
            flipper.displayedChild = 4
        }

        var loginPasswordVisible = false
        ivLoginEye.setOnClickListener {
            loginPasswordVisible = !loginPasswordVisible

            etLoginPassword.inputType =
                if (loginPasswordVisible) {
                    android.text.InputType.TYPE_CLASS_TEXT or
                            android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                } else {
                    android.text.InputType.TYPE_CLASS_TEXT or
                            android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                }

            etLoginPassword.setSelection(etLoginPassword.text?.length ?: 0)
        }
    }



    private fun updateLoginButtonState() {
        btnContinue.isEnabled =
            etPhone.text.toString().trim().length >= 6 &&
                    etLoginPassword.text.toString().trim().isNotBlank()
    }

    private fun buildFullPhone(): String {
        val code = actCountryCode.text.toString().trim()
        var local = etPhone.text.toString().trim().replace("\\s".toRegex(), "")

        if (local.startsWith("0")) {
            local = local.substring(1)
        }
        if (local.startsWith("+")) {
            return local
        }

        return code + local
    }

    private fun buildSignupFullPhone(): String {
        val code = actSignupCountryCode.text.toString().trim()
        var local = etSignupPhone.text.toString().trim().replace("\\s".toRegex(), "")

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
            updateLoginButtonState()
        })

        etLoginPassword.addTextChangedListener(SimpleTextWatcher {
            updateLoginButtonState()
        })

        btnContinue.setOnClickListener {
            val fullPhone = buildFullPhone()
            val password = etLoginPassword.text.toString().trim()

            if (password.isBlank()) {
                Toast.makeText(this, "Enter your password", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            login(fullPhone, password) { token, hasPin ->
                session.saveToken(token)
                session.savePhone(fullPhone)

                if (hasPin) {
                    flipper.displayedChild = 3
                } else {
                    flipper.displayedChild = 2
                }
            }
        }
    }

    private fun setupOtpScreen() {
        btnVerify.isEnabled = false

        fun renderOtpBoxes(code: String) {
            otpBox1.text = code.getOrNull(0)?.toString() ?: ""
            otpBox2.text = code.getOrNull(1)?.toString() ?: ""
            otpBox3.text = code.getOrNull(2)?.toString() ?: ""
            otpBox4.text = code.getOrNull(3)?.toString() ?: ""
            otpBox5.text = code.getOrNull(4)?.toString() ?: ""
            otpBox6.text = code.getOrNull(5)?.toString() ?: ""

            btnVerify.isEnabled = code.length == 6
        }

        etOtp.addTextChangedListener(SimpleTextWatcher {
            val code = etOtp.text.toString().trim()
            renderOtpBoxes(code)
        })

        otpBoxesRow.setOnClickListener {
            etOtp.requestFocus()
            etOtp.post {
                val imm = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                imm.showSoftInput(etOtp, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
            }
        }

        btnBackOtp.setOnClickListener {
            flipper.displayedChild = if (pendingSignup != null) 4 else 0
        }

        btnVerify.setOnClickListener {
            val signup = pendingSignup
            val otp = etOtp.text.toString().trim()

            if (signup == null) {
                Toast.makeText(this, "No signup request found. Please create account again.", Toast.LENGTH_LONG).show()
                flipper.displayedChild = 4
                return@setOnClickListener
            }

            signupVerifyOtp(
                phone = signup.phone,
                otp = otp,
                password = signup.password,
                accountType = signup.accountType,
                countryCode = signup.countryCode,
                termsAccepted = signup.termsAccepted
            ) { token, hasPin ->
                session.saveToken(token)
                session.savePhone(signup.phone)
                pendingSignup = null

                if (hasPin) {
                    flipper.displayedChild = 3
                } else {
                    flipper.displayedChild = 2
                }

                etOtp.text?.clear()
                renderOtpBoxes("")
            }
        }

        renderOtpBoxes("")
    }

    private fun setupPinSetScreen() {
        btnSetPin.isEnabled = false

        etPin.addTextChangedListener(SimpleTextWatcher {
            btnSetPin.isEnabled = etPin.text.toString().trim().length == 4
        })

        btnBackPin.setOnClickListener {
            flipper.displayedChild = 0
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
            pendingSignup = null
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

    private fun login(
        phone: String,
        password: String,
        onSuccess: (token: String, hasPin: Boolean) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.login(phone, password)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token, res.hasPin)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Login failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun signupRequestOtp(
        phone: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean,
        onSuccess: () -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.signupRequestOtp(
                    phone = phone,
                    password = password,
                    accountType = accountType,
                    countryCode = countryCode,
                    termsAccepted = termsAccepted
                )
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

    private fun signupVerifyOtp(
        phone: String,
        otp: String,
        password: String,
        accountType: String,
        countryCode: String,
        termsAccepted: Boolean,
        onSuccess: (token: String, hasPin: Boolean) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.signupVerifyOtp(
                    phone = phone,
                    otp = otp,
                    password = password,
                    accountType = accountType,
                    countryCode = countryCode,
                    termsAccepted = termsAccepted
                )
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token, res.hasPin)
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

    private fun setupCreateAccountScreen() {
        val accountTypes = listOf("Personal", "Agent", "Merchant")
        val codes = listOf("+249", "+211", "+256", "+20")

        actAccountType.setAdapter(ArrayAdapter(this, R.layout.item_country_code, accountTypes))
        actAccountType.setText("Personal", false)

        actSignupCountryCode.setAdapter(ArrayAdapter(this, R.layout.item_country_code, codes))
        actSignupCountryCode.setText("+249", false)

        actAccountType.setOnClickListener {
            actAccountType.showDropDown()
        }
        actAccountType.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) actAccountType.showDropDown()
        }

        actSignupCountryCode.setOnClickListener {
            actSignupCountryCode.showDropDown()
        }
        actSignupCountryCode.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) actSignupCountryCode.showDropDown()
        }

        actAccountType.dropDownWidth = 500
        actSignupCountryCode.dropDownWidth = 300

        fun validateSignup() {
            val phoneOk = etSignupPhone.text.toString().trim().length >= 6
            val pass = etSignupPassword.text.toString().trim()
            val confirm = etSignupConfirmPassword.text.toString().trim()
            val passOk = pass.length >= 4
            val confirmOk = pass == confirm
            btnCreateAccount.isEnabled = phoneOk && passOk && confirmOk && cbTerms.isChecked
        }

        etSignupPhone.addTextChangedListener(SimpleTextWatcher { validateSignup() })
        etSignupPassword.addTextChangedListener(SimpleTextWatcher { validateSignup() })
        etSignupConfirmPassword.addTextChangedListener(SimpleTextWatcher { validateSignup() })
        cbTerms.setOnCheckedChangeListener { _, _ -> validateSignup() }

        var signupPasswordVisible = false
        ivSignupEye1.setOnClickListener {
            signupPasswordVisible = !signupPasswordVisible

            etSignupPassword.inputType =
                if (signupPasswordVisible) {
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                } else {
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                }

            etSignupPassword.setSelection(etSignupPassword.text?.length ?: 0)
        }

        var signupConfirmVisible = false
        ivSignupEye2.setOnClickListener {
            signupConfirmVisible = !signupConfirmVisible

            etSignupConfirmPassword.inputType =
                if (signupConfirmVisible) {
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                } else {
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                }

            etSignupConfirmPassword.setSelection(etSignupConfirmPassword.text?.length ?: 0)
        }

        btnCreateAccount.setOnClickListener {
            val phone = buildSignupFullPhone()
            val password = etSignupPassword.text.toString().trim()
            val confirm = etSignupConfirmPassword.text.toString().trim()
            val accountType = actAccountType.text.toString().trim()
            val countryCode = actSignupCountryCode.text.toString().trim()
            val termsAccepted = cbTerms.isChecked

            if (password != confirm) {
                Toast.makeText(this, "Passwords do not match", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            pendingSignup = PendingSignup(
                phone = phone,
                password = password,
                accountType = accountType,
                countryCode = countryCode,
                termsAccepted = termsAccepted
            )

            signupRequestOtp(
                phone = phone,
                password = password,
                accountType = accountType,
                countryCode = countryCode,
                termsAccepted = termsAccepted
            ) {
                flipper.displayedChild = 1
                tvOtpHint.text = "Enter the code sent to $phone"
                etOtp.text?.clear()
            }
        }

        loginInsteadRow.setOnClickListener {
            pendingSignup = null
            flipper.displayedChild = 0
        }

        validateSignup()
    }
}