package com.jeezpay.app.ui.receipt

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.R
import java.text.DecimalFormat

class ReceiptActivity : AppCompatActivity() {

    private val df = DecimalFormat("#,##0.00")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_receipt)

        val tvTo = findViewById<TextView>(R.id.tvTo)
        val tvAmount = findViewById<TextView>(R.id.tvAmount)
        val tvCurrency = findViewById<TextView>(R.id.tvCurrency)
        val tvDesc = findViewById<TextView>(R.id.tvDesc)
        val tvTime = findViewById<TextView>(R.id.tvTime)


        val btnDone = findViewById<MaterialButton>(R.id.btnDone)
        btnDone.setOnClickListener { finish() }

        val toPhone = intent.getStringExtra("toPhone") ?: "-"
        val currency = intent.getStringExtra("currency") ?: "-"
        val amount = intent.getDoubleExtra("amount", 0.0)
        val description = intent.getStringExtra("description") ?: "-"
        val createdAt = intent.getStringExtra("createdAt") ?: "-"

        val tvReference = findViewById<TextView>(R.id.tvReference)

        val reference = intent.getStringExtra("reference") ?: "-"
        tvReference.text = reference



        tvTo.text = toPhone
        tvAmount.text = df.format(amount)
        tvCurrency.text = currency
        tvDesc.text = if (description.isBlank()) "-" else description
        tvTime.text = createdAt

    }
}
