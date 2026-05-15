package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import java.text.DecimalFormat

class SwapReceiptActivity : AppCompatActivity() {

    private val df = DecimalFormat("#,##0.##")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_swap_receipt)

        val tvReceiveAmount = findViewById<TextView>(R.id.tvReceiveAmount)
        val tvReceiveSubtitle = findViewById<TextView>(R.id.tvReceiveSubtitle)
        val tvReference = findViewById<TextView>(R.id.tvReference)
        val tvFrom = findViewById<TextView>(R.id.tvFrom)
        val tvTo = findViewById<TextView>(R.id.tvTo)
        val tvRate = findViewById<TextView>(R.id.tvRate)
        val btnDone = findViewById<MaterialButton>(R.id.btnDone)

        val reference = intent.getStringExtra("reference") ?: "-"
        val fromCurrency = intent.getStringExtra("fromCurrency") ?: "-"
        val toCurrency = intent.getStringExtra("toCurrency") ?: "-"
        val amount = intent.getDoubleExtra("amount", 0.0)
        val receiveAmount = intent.getDoubleExtra("receiveAmount", 0.0)
        val rate = intent.getDoubleExtra("rate", 0.0)

        tvReceiveAmount.text = "${df.format(receiveAmount)} $toCurrency"
        tvReceiveSubtitle.text = "Received"
        tvReference.text = "Reference: $reference"
        tvFrom.text = "From: ${df.format(amount)} $fromCurrency"
        tvTo.text = "To: ${df.format(receiveAmount)} $toCurrency"
        tvRate.text = "Rate: 1 $fromCurrency = ${df.format(rate)} $toCurrency"

        btnDone.setOnClickListener {
            finish()
        }
    }
}