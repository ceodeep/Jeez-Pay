package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class LimitsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_info_page)

        findViewById<TextView>(R.id.tvTitle).text = "Limits"

        findViewById<TextView>(R.id.tvContent).text = """
Daily transfer limit: 5,000 USDT

Single transfer limit: 1,000 USDT

Monthly wallet activity limit: 50,000 USDT

Limits may increase after completing identity verification (KYC).
        """.trimIndent()

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}