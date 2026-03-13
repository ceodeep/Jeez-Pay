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

    companion object{const val EXTRA_FORCE_LOGIN = "extra_force_login"}

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
    private lateinit var setPinDot1: android.widget.ImageView
    private lateinit var setPinDot2: android.widget.ImageView
    private lateinit var setPinDot3: android.widget.ImageView
    private lateinit var setPinDot4: android.widget.ImageView
    private lateinit var unlockDot1: android.widget.ImageView
    private lateinit var unlockDot2: android.widget.ImageView
    private lateinit var unlockDot3: android.widget.ImageView
    private lateinit var unlockDot4: android.widget.ImageView
    private lateinit var etUnlockPin: EditText
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
    private lateinit var btnAccountCreatedContinue: MaterialButton
    private lateinit var tvForgotPin: TextView

    private val countryCodes = listOf("+249", "+211", "+256", "+20")

    private enum class OtpFlowMode {
        SIGNUP,
        FORGOT_PASSWORD,
        FORGOT_PIN
    }

    private var otpFlowMode: OtpFlowMode = OtpFlowMode.SIGNUP
    private var pendingForgotPasswordPhone: String? = null
    private var pendingForgotPasswordNewPassword: String? = null



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
        setupAccountCreatedScreen()
    }

    private fun bindViews() {
        flipper = findViewById(R.id.authFlipper)

        etPhone = findViewById(R.id.etPhone)
        btnContinue = findViewById(R.id.btnContinue)
        actCountryCode = findViewById(R.id.actCountryCode)
        createAccountRow = findViewById(R.id.createAccountRow)
        tvForgotPassword = findViewById(R.id.tvForgotPassword)
        tvForgotPin = findViewById(R.id.tvForgotPin)
        passwordBox = findViewById(R.id.passwordBox)

        otpBox1 = findViewById(R.id.otpBox1)
        otpBox2 = findViewById(R.id.otpBox2)
        otpBox3 = findViewById(R.id.otpBox3)
        otpBox4 = findViewById(R.id.otpBox4)
        otpBox5 = findViewById(R.id.otpBox5)
        otpBox6 = findViewById(R.id.otpBox6)
        unlockDot1 = findViewById(R.id.unlockDot1)
        unlockDot2 = findViewById(R.id.unlockDot2)
        unlockDot3 = findViewById(R.id.unlockDot3)
        unlockDot4 = findViewById(R.id.unlockDot4)
        etUnlockPin = findViewById(R.id.etUnlockPin)
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

        setPinDot1 = findViewById(R.id.setPinDot1)
        setPinDot2 = findViewById(R.id.setPinDot2)
        setPinDot3 = findViewById(R.id.setPinDot3)
        setPinDot4 = findViewById(R.id.setPinDot4)
        btnAccountCreatedContinue = findViewById(R.id.btnAccountCreatedContinue)
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
            val fullPhone = buildFullPhone()

            if (etPhone.text.toString().trim().length < 6) {
                Toast.makeText(this, "Enter your phone number first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val input = EditText(this).apply {
                hint = "Enter new password"
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            }

            com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle("Reset Password")
                .setView(input)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Continue") { _, _ ->
                    val newPassword = input.text.toString().trim()

                    if (newPassword.length < 4) {
                        Toast.makeText(this, "Password must be at least 4 characters", Toast.LENGTH_SHORT).show()
                        return@setPositiveButton
                    }

                    otpFlowMode = OtpFlowMode.FORGOT_PASSWORD
                    pendingForgotPasswordPhone = fullPhone
                    pendingForgotPasswordNewPassword = newPassword

                    forgotPasswordRequestOtp(fullPhone) {
                        flipper.displayedChild = 1
                        tvOtpHint.text = "Enter the code sent to $fullPhone"
                        etOtp.text?.clear()
                    }
                }
                .show()
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
        val forceLogin = intent.getBooleanExtra(EXTRA_FORCE_LOGIN, false)

        if (forceLogin) {
            flipper.displayedChild = 0
            return
        }

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
            flipper.displayedChild = if (otpFlowMode == OtpFlowMode.SIGNUP) 4 else 0
        }

        btnVerify.setOnClickListener {
            val otp = etOtp.text.toString().trim()

            when (otpFlowMode) {
                OtpFlowMode.SIGNUP -> {
                    val signup = pendingSignup
                    if (signup == null) {
                        Toast.makeText(
                            this,
                            "No signup request found. Please create account again.",
                            Toast.LENGTH_LONG
                        ).show()
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
                            flipper.displayedChild = 5
                        }

                        etOtp.text?.clear()
                        renderOtpBoxes("")
                    }
                }

                OtpFlowMode.FORGOT_PASSWORD -> {
                    val phone = pendingForgotPasswordPhone
                    val newPassword = pendingForgotPasswordNewPassword

                    if (phone.isNullOrBlank() || newPassword.isNullOrBlank()) {
                        Toast.makeText(
                            this,
                            "Reset request expired. Please try again.",
                            Toast.LENGTH_LONG
                        ).show()
                        flipper.displayedChild = 0
                        return@setOnClickListener
                    }

                    forgotPasswordVerifyOtp(
                        phone = phone,
                        otp = otp,
                        newPassword = newPassword
                    ) { token, hasPin ->
                        session.saveToken(token)
                        session.savePhone(phone)

                        pendingForgotPasswordPhone = null
                        pendingForgotPasswordNewPassword = null

                        if (hasPin) {
                            flipper.displayedChild = 3
                        } else {
                            flipper.displayedChild = 2
                        }

                        etOtp.text?.clear()
                        renderOtpBoxes("")
                    }
                }

                OtpFlowMode.FORGOT_PIN -> {
                    val phone = session.getPhone()

                    if (phone.isNullOrBlank()) {
                        Toast.makeText(
                            this,
                            "PIN reset request expired. Please login again.",
                            Toast.LENGTH_LONG
                        ).show()
                        flipper.displayedChild = 0
                        return@setOnClickListener
                    }

                    forgotPinVerifyOtp(
                        phone = phone,
                        otp = otp
                    ) { token, hasPin ->
                        session.saveToken(token)
                        session.savePhone(phone)
                        session.clearPin()

                        if (hasPin) {
                            flipper.displayedChild = 3
                        } else {
                            flipper.displayedChild = 2
                        }

                        etOtp.text?.clear()
                        renderOtpBoxes("")
                    }
                }
            }
        }

        renderOtpBoxes("")
    }

    private fun setupPinSetScreen() {

        val key1 = findViewById<TextView>(R.id.setPinKey1)
        val key2 = findViewById<TextView>(R.id.setPinKey2)
        val key3 = findViewById<TextView>(R.id.setPinKey3)
        val key4 = findViewById<TextView>(R.id.setPinKey4)
        val key5 = findViewById<TextView>(R.id.setPinKey5)
        val key6 = findViewById<TextView>(R.id.setPinKey6)
        val key7 = findViewById<TextView>(R.id.setPinKey7)
        val key8 = findViewById<TextView>(R.id.setPinKey8)
        val key9 = findViewById<TextView>(R.id.setPinKey9)
        val key0 = findViewById<TextView>(R.id.setPinKey0)
        val backspace = findViewById<android.widget.ImageView>(R.id.setPinBackspace)

        fun renderSetPinDots(pin: String) {
            setPinDot1.setImageResource(
                if (pin.length >= 1) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
            )
            setPinDot2.setImageResource(
                if (pin.length >= 2) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
            )
            setPinDot3.setImageResource(
                if (pin.length >= 3) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
            )
            setPinDot4.setImageResource(
                if (pin.length >= 4) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
            )

            btnSetPin.isEnabled = pin.length == 4
        }

        fun appendDigit(digit: String) {
            val current = etPin.text.toString()
            if (current.length >= 4) return

            val updated = current + digit
            etPin.setText(updated)
            etPin.setSelection(updated.length)
            renderSetPinDots(updated)
        }

        fun removeLastDigit() {
            val current = etPin.text.toString()
            if (current.isEmpty()) return

            val updated = current.dropLast(1)
            etPin.setText(updated)
            etPin.setSelection(updated.length)
            renderSetPinDots(updated)
        }

        key1.setOnClickListener { appendDigit("1") }
        key2.setOnClickListener { appendDigit("2") }
        key3.setOnClickListener { appendDigit("3") }
        key4.setOnClickListener { appendDigit("4") }
        key5.setOnClickListener { appendDigit("5") }
        key6.setOnClickListener { appendDigit("6") }
        key7.setOnClickListener { appendDigit("7") }
        key8.setOnClickListener { appendDigit("8") }
        key9.setOnClickListener { appendDigit("9") }
        key0.setOnClickListener { appendDigit("0") }

        backspace.setOnClickListener {
            removeLastDigit()
        }

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

        renderSetPinDots("")
    }

    private fun setupUnlockScreen() {

        val key1 = findViewById<TextView>(R.id.unlockKey1)
        val key2 = findViewById<TextView>(R.id.unlockKey2)
        val key3 = findViewById<TextView>(R.id.unlockKey3)
        val key4 = findViewById<TextView>(R.id.unlockKey4)
        val key5 = findViewById<TextView>(R.id.unlockKey5)
        val key6 = findViewById<TextView>(R.id.unlockKey6)
        val key7 = findViewById<TextView>(R.id.unlockKey7)
        val key8 = findViewById<TextView>(R.id.unlockKey8)
        val key9 = findViewById<TextView>(R.id.unlockKey9)
        val key0 = findViewById<TextView>(R.id.unlockKey0)
        val backspace = findViewById<android.widget.ImageView>(R.id.unlockBackspace)



        fun appendDigit(digit: String) {
            if (session.isPinLocked()) {
                val seconds = (session.getPinLockRemainingMillis() / 1000L).coerceAtLeast(1L)
                Toast.makeText(
                    this,
                    "Too many failed attempts. Try again in ${seconds}s.",
                    Toast.LENGTH_SHORT
                ).show()
                return
            }

            val current = etUnlockPin.text.toString()
            if (current.length >= 4) return

            val updated = current + digit
            etUnlockPin.setText(updated)
            etUnlockPin.setSelection(updated.length)
            renderUnlockDotsSafe(updated)
        }

        fun removeLastDigit() {
            if (session.isPinLocked()) return

            val current = etUnlockPin.text.toString()
            if (current.isEmpty()) return

            val updated = current.dropLast(1)
            etUnlockPin.setText(updated)
            etUnlockPin.setSelection(updated.length)
            renderUnlockDotsSafe(updated)
        }

        key1.setOnClickListener { appendDigit("1") }
        key2.setOnClickListener { appendDigit("2") }
        key3.setOnClickListener { appendDigit("3") }
        key4.setOnClickListener { appendDigit("4") }
        key5.setOnClickListener { appendDigit("5") }
        key6.setOnClickListener { appendDigit("6") }
        key7.setOnClickListener { appendDigit("7") }
        key8.setOnClickListener { appendDigit("8") }
        key9.setOnClickListener { appendDigit("9") }
        key0.setOnClickListener { appendDigit("0") }
        backspace.setOnClickListener { removeLastDigit() }

        btnUnlock.setOnClickListener {
            if (session.isPinLocked()) {
                val seconds = (session.getPinLockRemainingMillis() / 1000L).coerceAtLeast(1L)
                Toast.makeText(
                    this,
                    "Too many failed attempts. Try again in ${seconds}s.",
                    Toast.LENGTH_SHORT
                ).show()
                return@setOnClickListener
            }

            val pin = etUnlockPin.text.toString().trim()
            if (pin.length != 4) {
                Toast.makeText(this, "PIN must be 4 digits", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            pendingPinAction = PinAction.VERIFY_LOGIN
            verifyPinOnBackend(pin)
        }

        btnUseAnotherAccount.setOnClickListener {
            session.clearAll()
            flipper.displayedChild = 0
        }

        renderUnlockDotsSafe("")

        tvForgotPin.setOnClickListener {
            val phone = session.getPhone()

            if (phone.isNullOrBlank()) {
                Toast.makeText(
                    this,
                    "Session expired. Please login again.",
                    Toast.LENGTH_SHORT
                ).show()

                session.clearAll()
                flipper.displayedChild = 0
                return@setOnClickListener
            }

            forgotPinRequestOtp(phone) {
                otpFlowMode = OtpFlowMode.FORGOT_PIN
                flipper.displayedChild = 1
                tvOtpHint.text = "Enter the code sent to $phone"
                etOtp.text?.clear()
            }
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
                    session.savePin(pin)
                    session.resetFailedPinAttempts()

                    Toast.makeText(this@AuthActivity, "PIN set successfully", Toast.LENGTH_SHORT).show()

                    etPin.text?.clear()
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
        if (session.isPinLocked()) {
            val seconds = (session.getPinLockRemainingMillis() / 1000L).coerceAtLeast(1L)
            Toast.makeText(
                this,
                "Too many failed attempts. Try again in ${seconds}s.",
                Toast.LENGTH_SHORT
            ).show()
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.verifyPin(pin)
                withContext(Dispatchers.Main) {
                    if (!res.ok) {
                        val attempts = session.incrementFailedPinAttempts()

                        if (attempts >= SessionManager.MAX_PIN_ATTEMPTS) {
                            session.lockPinForMillis(SessionManager.PIN_LOCK_DURATION_MS)
                            Toast.makeText(
                                this@AuthActivity,
                                "Too many attempts. Locked for 60 seconds.",
                                Toast.LENGTH_SHORT
                            ).show()
                        } else {
                            val remaining = SessionManager.MAX_PIN_ATTEMPTS - attempts
                            Toast.makeText(
                                this@AuthActivity,
                                "${res.message ?: "Wrong PIN"}. $remaining attempt(s) left.",
                                Toast.LENGTH_SHORT
                            ).show()
                        }

                        etUnlockPin.text?.clear()
                        renderUnlockDotsSafe("")
                        return@withContext
                    }

                    session.savePin(pin)
                    session.resetFailedPinAttempts()
                    etUnlockPin.text?.clear()
                    renderUnlockDotsSafe("")

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
            otpFlowMode = OtpFlowMode.SIGNUP

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
    private fun setupAccountCreatedScreen() {
        btnAccountCreatedContinue.setOnClickListener {
            flipper.displayedChild = 2
        }
    }

    private fun forgotPasswordRequestOtp(phone: String, onSuccess: () -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.forgotPasswordRequestOtp(phone)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "Reset OTP failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun forgotPasswordVerifyOtp(
        phone: String,
        otp: String,
        newPassword: String,
        onSuccess: (token: String, hasPin: Boolean) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.forgotPasswordVerifyOtp(phone, otp, newPassword)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token, res.hasPin)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "Reset verify failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun forgotPinRequestOtp(phone: String, onSuccess: () -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.forgotPinRequestOtp(phone)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "PIN reset OTP failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun forgotPinVerifyOtp(
        phone: String,
        otp: String,
        onSuccess: (token: String, hasPin: Boolean) -> Unit
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.forgotPinVerifyOtp(phone, otp)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.token, res.hasPin)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@AuthActivity,
                        "PIN reset verify failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }
    private fun renderUnlockDotsSafe(pin: String) {
        unlockDot1.setImageResource(
            if (pin.length >= 1) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
        )
        unlockDot2.setImageResource(
            if (pin.length >= 2) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
        )
        unlockDot3.setImageResource(
            if (pin.length >= 3) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
        )
        unlockDot4.setImageResource(
            if (pin.length >= 4) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty
        )

        val enabled = pin.length == 4 && !session.isPinLocked()
        btnUnlock.isEnabled = enabled
    }

}