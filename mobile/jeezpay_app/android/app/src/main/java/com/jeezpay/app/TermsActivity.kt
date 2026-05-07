package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class TermsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_info_page)

        findViewById<TextView>(R.id.tvTitle).text = "Terms & Conditions"

        findViewById<TextView>(R.id.tvContent).text = """
By using JeezPay, you agree to comply with all applicable laws and platform rules.

Users are responsible for securing their accounts and PINs.

Fraudulent activity, abuse, or unauthorized transactions may result in account suspension.

JeezPay reserves the right to update platform policies and limits when necessary.
        """.trimIndent()

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}