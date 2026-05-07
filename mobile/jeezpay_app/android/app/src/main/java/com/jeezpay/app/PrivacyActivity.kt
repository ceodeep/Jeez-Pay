package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class PrivacyActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_info_page)

        findViewById<TextView>(R.id.tvTitle).text = "Privacy Policy"
        findViewById<TextView>(R.id.tvInfoSubtitle).text =
            "How JeezPay handles, protects, and uses your personal information."

        findViewById<TextView>(R.id.tvContent).text = """
Data we collect

We collect the information needed to create your account, verify your identity, process transactions, and protect your wallet.

How we use it

Your information is used to keep your account secure, prevent fraud, verify KYC, and provide JeezPay services.

Data protection

We use secure storage, access control, and encryption practices to protect sensitive account and transaction data.

Data sharing

JeezPay does not sell your personal information. We only share information when required for compliance, fraud prevention, or service operation.
""".trimIndent()

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}