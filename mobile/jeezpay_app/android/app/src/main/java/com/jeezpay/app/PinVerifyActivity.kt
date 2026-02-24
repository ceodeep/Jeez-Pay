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

    private lateinit var dot1: ImageView
    private lateinit var dot2: ImageView
    private lateinit var dot3: ImageView
    private lateinit var dot4: ImageView
    private lateinit var btnConfirm: TextView

    private var savedPin: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pin_verify)

        savedPin = SessionManager(this).getPin()

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

        // Backspace (your XML id is btnBackspace)
        findViewById<View>(R.id.btnBackspace).setOnClickListener {
            onBackspace()
        }

        // If no saved PIN, stop here (don’t allow “any pin”)
        if (savedPin.isNullOrBlank()) {
            Toast.makeText(this, "No transaction PIN set. Please set a PIN first.", Toast.LENGTH_LONG).show()
            // Optional: finish() or navigate to set-pin screen if you have one
        }

        updateDots()
    }

    private fun bindDigit(viewId: Int, digit: Int) {
        findViewById<View>(viewId).setOnClickListener { onDigit(digit) }
    }

    private fun onDigit(digit: Int) {
        if (pin.length >= 4) return
        pin.append(digit)
        updateDots()

        // Optional auto-check when reaches 4
        if (pin.length == 4) {
            verifyOrReject()
        }
    }

    private fun onBackspace() {
        if (pin.isNotEmpty()) {
            pin.deleteCharAt(pin.length - 1)
            updateDots()
        }
    }

    private fun verifyOrReject() {
        val entered = pin.toString()
        val saved = savedPin

        if (saved.isNullOrBlank()) {
            Toast.makeText(this, "No transaction PIN set for this account.", Toast.LENGTH_SHORT).show()
            clearPin()
            return
        }

        if (entered != saved) {
            Toast.makeText(this, "Wrong PIN", Toast.LENGTH_SHORT).show()
            clearPin()
            return
        }

        // ✅ success
        finishWithPin(entered)
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

        val ok = len == 4
        btnConfirm.isEnabled = ok
        btnConfirm.alpha = if (ok) 1f else 0.6f
    }

    private fun finishWithPin(pin: String) {
        setResult(Activity.RESULT_OK, Intent().putExtra(RESULT_PIN, pin))
        finish()
    }
}