package com.jeezpay.app.ui.send

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.AutoCompleteTextView
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.R
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class SendMoneyActivity : AppCompatActivity() {

    private lateinit var vm: SendMoneyViewModel

    private lateinit var etPhone: EditText
    private lateinit var etAmount: EditText
    private lateinit var ddCurrency: AutoCompleteTextView
    private lateinit var etDesc: EditText
    private lateinit var btnSend: MaterialButton
    private lateinit var progress: ProgressBar
    private lateinit var tvError: TextView

    private val currencies = listOf("USDT", "SDG", "SSP", "EGP", "UGX")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_send_money)

        vm = ViewModelProvider(this)[SendMoneyViewModel::class.java]

        etPhone = findViewById(R.id.etPhone)
        etAmount = findViewById(R.id.etAmount)
        ddCurrency = findViewById(R.id.ddCurrency)
        etDesc = findViewById(R.id.etDesc)
        btnSend = findViewById(R.id.btnSend)
        progress = findViewById(R.id.progress)
        tvError = findViewById(R.id.tvError)

        // Setup dropdown
        val adapter = android.widget.ArrayAdapter(
            this,
            android.R.layout.simple_dropdown_item_1line,
            currencies
        )
        ddCurrency.setAdapter(adapter)
        ddCurrency.setText("USDT", false) // default

        btnSend.setOnClickListener {
            tvError.visibility = View.GONE

            val phone = etPhone.text.toString().trim()
            val amountText = etAmount.text.toString().trim()
            val currency = ddCurrency.text.toString().trim().uppercase()
            val description = etDesc.text.toString().trim().ifEmpty { null }

            val amount = amountText.toDoubleOrNull()

            if (phone.isEmpty()) {
                showError("Receiver phone is required")
                return@setOnClickListener
            }
            if (amount == null || amount <= 0) {
                showError("Enter a valid amount")
                return@setOnClickListener
            }
            if (currency.isEmpty() || currency !in currencies) {
                showError("Select a valid currency")
                return@setOnClickListener
            }

            vm.sendMoney(
                toPhone = phone,
                currency = currency,
                amount = amount,
                description = description
            )
        }

        lifecycleScope.launch {
            vm.state.collect { state ->
                when (state) {
                    is SendMoneyUiState.Idle -> {
                        progress.visibility = View.GONE
                        btnSend.isEnabled = true
                    }

                    is SendMoneyUiState.Loading -> {
                        progress.visibility = View.VISIBLE
                        btnSend.isEnabled = false
                    }

                    is SendMoneyUiState.Error -> {
                        progress.visibility = View.GONE
                        btnSend.isEnabled = true
                        showError(state.message)
                    }

                    is SendMoneyUiState.Success -> {
                        progress.visibility = View.GONE
                        btnSend.isEnabled = true

                        val res = state.res

                        openReceipt(
                            toPhone = etPhone.text.toString().trim(),
                            currency = res.currency?: "-",
                            amount = res.amount?: 0.0,
                            description = etDesc.text.toString().trim(),
                            createdAtIso = java.text.SimpleDateFormat(
                                "yyyy-MM-dd HH:mm:ss",
                                java.util.Locale.getDefault()
                            ).format(java.util.Date()),
                            reference = res.reference ?: "-"

                        )

                        vm.reset()
                    }
                }
            }
        }
    }

    private fun showError(msg: String) {
        tvError.text = msg
        tvError.visibility = View.VISIBLE
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun openReceipt(
        toPhone: String,
        currency: String,
        amount: Double,
        description: String?,
        createdAtIso: String,
        reference: String
    ) {
        val i = Intent(this, com.jeezpay.app.ui.receipt.ReceiptActivity::class.java).apply {
            putExtra("toPhone", toPhone)
            putExtra("currency", currency)
            putExtra("amount", amount)
            putExtra("description", description ?: "")
            putExtra("createdAt", createdAtIso)
            putExtra("refernce", reference)

            // ✅ pass balances (if null we just won't show)
        }
        startActivity(i)
        finish()
    }


    private fun isoNow(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}
