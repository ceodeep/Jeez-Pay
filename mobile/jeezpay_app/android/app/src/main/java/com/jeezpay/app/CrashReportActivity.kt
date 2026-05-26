package com.jeezpay.app

import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class CrashReportActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val crash = intent.getStringExtra("crash") ?: "No crash details found."

        val tv = TextView(this).apply {
            text = crash
            textSize = 12f
            setPadding(32, 32, 32, 32)
            setTextIsSelectable(true)
        }

        val scroll = ScrollView(this).apply {
            addView(tv)
        }

        setContentView(scroll)
    }
}