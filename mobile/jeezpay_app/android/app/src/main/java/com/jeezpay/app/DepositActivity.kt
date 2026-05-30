package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.jeezpay.app.base.BaseFintechActivity

class DepositActivity : BaseFintechActivity() {

    private lateinit var btnBack: View
    private lateinit var rowUsdt: LinearLayout
    private lateinit var rowEgp: LinearLayout
    private lateinit var rowSdg: LinearLayout
    private lateinit var rowSsp: LinearLayout
    private lateinit var rowUgx: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_deposit)

        btnBack = findViewById(R.id.btnBack)
        rowUsdt = findViewById(R.id.rowUsdt)
        rowEgp = findViewById(R.id.rowEgp)
        rowSdg = findViewById(R.id.rowSdg)
        rowSsp = findViewById(R.id.rowSsp)
        rowUgx = findViewById(R.id.rowUgx)

        btnBack.setOnClickListener { finish() }

        rowUsdt.setOnClickListener {
            startActivity(Intent(this, DepositUsdtActivity::class.java))
        }

        rowEgp.setOnClickListener {
            showComingSoon("EGP deposit via Vodafone Cash")
        }

        rowSdg.setOnClickListener {
            showComingSoon("SDG deposit via Bankak / local transfer")
        }

        rowSsp.setOnClickListener {
            showComingSoon("SSP deposit via local agent or bank transfer")
        }
        rowUgx.setOnClickListener {
            showComingSoon("UGX deposit via Mobile Money / local transfer")
        }
    }

    private fun showComingSoon(method: String) {
        Toast.makeText(this, "$method coming soon", Toast.LENGTH_SHORT).show()
    }
}