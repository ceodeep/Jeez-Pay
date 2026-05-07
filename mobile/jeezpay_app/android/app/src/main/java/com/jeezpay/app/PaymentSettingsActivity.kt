package com.jeezpay.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class PaymentSettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_payment_settings)

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}