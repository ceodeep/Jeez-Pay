package com.jeezpay.app


import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_auth)

        session = SessionManager(this)

        val existingToken = session.getToken()
        val existingPin = session.getPin()
        if (!existingToken.isNullOrBlank() && !existingPin.isNullOrBlank()) {
            openMain()
            return
        }


        val flipper = findViewById<android.widget.ViewFlipper>(R.id.authFlipper)

        val etPhone = findViewById<EditText>(R.id.etPhone)
        val btnContinue = findViewById<MaterialButton>(R.id.btnContinue)

        val btnBackOtp = findViewById<TextView>(R.id.btnBackOtp)
        val tvOtpHint = findViewById<TextView>(R.id.tvOtpHint)
        val etOtp = findViewById<EditText>(R.id.etOtp)
        val btnVerify = findViewById<MaterialButton>(R.id.btnVerify)

        val btnBackPin = findViewById<TextView>(R.id.btnBackPin)
        val etPin = findViewById<EditText>(R.id.etPin)
        val btnSetPin = findViewById<MaterialButton>(R.id.btnSetPin)

        // Enable Continue when phone has text
        etPhone.addTextChangedListener(SimpleTextWatcher {
            btnContinue.isEnabled = etPhone.text.toString().trim().length >= 8
        })

        // Enable Verify when OTP length is 6
        etOtp.addTextChangedListener(SimpleTextWatcher {
            btnVerify.isEnabled = etOtp.text.toString().trim().length == 6
        })

        // Enable Finish when PIN length is 4
        etPin.addTextChangedListener(SimpleTextWatcher {
            btnSetPin.isEnabled = etPin.text.toString().trim().length == 4
        })

        btnContinue.setOnClickListener {
            val phone = etPhone.text.toString().trim()
            requestOtp(phone, onSuccess = { maybeOtp ->
                // Move to OTP screen
                flipper.displayedChild = 1

                // OPTIONAL: show mocked OTP in hint (remove later for production)
                if (!maybeOtp.isNullOrBlank()) {
                    tvOtpHint.text = "Mock OTP: $maybeOtp"
                } else {
                    tvOtpHint.text = "Enter the code sent to your phone"
                }
            })
        }

        btnBackOtp.setOnClickListener {
            flipper.displayedChild = 0
        }

        btnVerify.setOnClickListener {
            val phone = etPhone.text.toString().trim()
            val otp = etOtp.text.toString().trim()

            verifyOtp(phone, otp, onSuccess = { token ->
                session.saveToken(token)
                flipper.displayedChild = 2 // go to PIN screen
            })
        }

        btnBackPin.setOnClickListener {
            flipper.displayedChild = 1
        }

        btnSetPin.setOnClickListener {
            val pin = etPin.text.toString().trim()
            if (pin.length != 4) {
                Toast.makeText(this, "PIN must be 4 digits", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // ✅ Save PIN locally (later we’ll encrypt/hash it)
            session.savePin(pin)

            openMain()
        }
    }

    private fun requestOtp(phone: String, onSuccess: (String?) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val res = repo.requestOtp(phone)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, res.message, Toast.LENGTH_SHORT).show()
                    onSuccess(res.otp)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Request OTP failed: ${e.message}", Toast.LENGTH_LONG).show()
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
                    Toast.makeText(this@AuthActivity, "Verify failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun openMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
