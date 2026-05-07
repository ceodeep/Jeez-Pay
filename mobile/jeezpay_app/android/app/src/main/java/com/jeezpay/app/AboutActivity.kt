package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class AboutActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_simple_page)

        findViewById<TextView>(R.id.tvTitle).text = "About JeezPay"

        val container = findViewById<android.widget.LinearLayout>(R.id.contentContainer)

        container.addView(createText("JeezPay is a digital payment platform that allows you to send, receive, and manage money securely."))

        container.addView(createText("Version 1.0.0"))
    }

    private fun createText(text: String): TextView {
        val tv = TextView(this)
        tv.text = text
        tv.textSize = 14f
        tv.setPadding(0, 16, 0, 16)
        return tv
    }
}
