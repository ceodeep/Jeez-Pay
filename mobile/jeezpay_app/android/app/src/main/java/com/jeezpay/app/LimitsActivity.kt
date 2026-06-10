package com.jeezpay.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class LimitsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_limits)

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}