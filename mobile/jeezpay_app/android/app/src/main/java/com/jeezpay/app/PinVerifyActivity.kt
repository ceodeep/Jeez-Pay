package com.jeezpay.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.jeezpay.app.storage.SessionManager

class PinVerifyActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SUBTITLE = "extra_subtitle"
        const val RESULT_PIN = "result_pin"
    }

    private val pin = StringBuilder()

    private lateinit var sessionManager: SessionManager

    private lateinit var dot1: ImageView
    private lateinit var dot2: ImageView
    private lateinit var dot3: ImageView
    private lateinit var dot4: ImageView
    private lateinit var btnConfirm: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pin_verify)

        sessionManager = SessionManager(this)

        // Header
        val tvHeader = findViewById<TextView>(R.id.tvHeader)
        val tvSubTitle = findViewById<TextView>(R.id.tvSubTitle)
        val ivBack = findViewById<ImageView>(R.id.ivBack)

        tvHeader.text = intent.getStringExtra(EXTRA_TITLE) ?: "Verification"
        tvSubTitle.text = intent.getStringExtra(EXTRA_SUBTITLE)
            ?: "Kindly enter your transaction PIN to continue"

        ivBack.setOnClickListener { finish() }

        // Dots
        dot1 = findViewById(R.id.dot1)
        dot2 = findViewById(R.id.dot2)
        dot3 = findViewById(R.id.dot3)
        dot4 = findViewById(R.id.dot4)

        // Confirm
        btnConfirm = findViewById(R.id.btnConfirm)
        btnConfirm.isEnabled = false
        btnConfirm.alpha = 0.6f
        btnConfirm.setOnClickListener {
            if (pin.length == 4) {
                verifyOrReject()
            }
        }

        // Keypad digits
        bindDigit(R.id.key1, 1)
        bindDigit(R.id.key2, 2)
        bindDigit(R.id.key3, 3)
        bindDigit(R.id.key4, 4)
        bindDigit(R.id.key5, 5)
        bindDigit(R.id.key6, 6)
        bindDigit(R.id.key7, 7)
        bindDigit(R.id.key8, 8)
        bindDigit(R.id.key9, 9)
        bindDigit(R.id.key0, 0)

        // Backspace
        findViewById<View>(R.id.btnBackspace).setOnClickListener {
            onBackspace()
        }

        if (!sessionManager.hasPin()) {
            Toast.makeText(
                this,
                "No transaction PIN set. Please set a PIN first.",
                Toast.LENGTH_LONG
            ).show()
            finish()
            return
        }

        checkLockedState()
        updateDots()
    }

    private fun bindDigit(viewId: Int, digit: Int) {
        findViewById<View>(viewId).setOnClickListener {
            if (sessionManager.isPinLocked()) {
                showLockedMessage()
                return@setOnClickListener
            }
            onDigit(digit)
        }
    }

    private fun onDigit(digit: Int) {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            return
        }

        if (pin.length >= 4) return

        pin.append(digit)
        updateDots()

        if (pin.length == 4) {
            verifyOrReject()
        }
    }

    private fun onBackspace() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            return
        }

        if (pin.isNotEmpty()) {
            pin.deleteCharAt(pin.length - 1)
            updateDots()
        }
    }

    private fun verifyOrReject() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
            clearPin()
            return
        }

        val entered = pin.toString()

        if (!sessionManager.hasPin()) {
            Toast.makeText(this, "No transaction PIN set for this account.", Toast.LENGTH_SHORT).show()
            clearPin()
            finish()
            return
        }

        val verified = sessionManager.verifyPin(entered)

        if (!verified) {
            val attempts = sessionManager.incrementFailedPinAttempts()

            if (attempts >= SessionManager.MAX_PIN_ATTEMPTS) {
                sessionManager.lockPinForMillis(SessionManager.PIN_LOCK_DURATION_MS)
                Toast.makeText(
                    this,
                    "Too many attempts. Locked for 60 seconds.",
                    Toast.LENGTH_SHORT
                ).show()
            } else {
                val remaining = SessionManager.MAX_PIN_ATTEMPTS - attempts
                Toast.makeText(
                    this,
                    "Wrong PIN. $remaining attempt(s) left.",
                    Toast.LENGTH_SHORT
                ).show()
            }

            clearPin()
            updateDots()
            return
        }

        sessionManager.resetFailedPinAttempts()
        finishWithPin(entered)
    }

    private fun checkLockedState() {
        if (sessionManager.isPinLocked()) {
            showLockedMessage()
        }
    }

    private fun showLockedMessage() {
        val seconds = (sessionManager.getPinLockRemainingMillis() / 1000L)
            .coerceAtLeast(1L)
        Toast.makeText(
            this,
            "Too many failed attempts. Try again in ${seconds}s.",
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun clearPin() {
        pin.clear()
        updateDots()
    }

    private fun updateDots() {
        val len = pin.length

        dot1.setImageResource(if (len >= 1) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty)
        dot2.setImageResource(if (len >= 2) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty)
        dot3.setImageResource(if (len >= 3) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty)
        dot4.setImageResource(if (len >= 4) R.drawable.ic_pin_dot_filled else R.drawable.ic_pin_dot_empty)

        val ok = len == 4 && !sessionManager.isPinLocked()
        btnConfirm.isEnabled = ok
        btnConfirm.alpha = if (ok) 1f else 0.6f
    }

    private fun finishWithPin(pin: String) {
        setResult(Activity.RESULT_OK, Intent().putExtra(RESULT_PIN, pin))
        finish()
    }
}