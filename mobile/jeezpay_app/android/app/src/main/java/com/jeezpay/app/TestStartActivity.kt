package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class TestStartActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val tv = TextView(this).apply {
            text = "JeezPay test launch works"
            textSize = 22f
            setPadding(40, 80, 40, 40)
        }

        setContentView(tv)
    }
}