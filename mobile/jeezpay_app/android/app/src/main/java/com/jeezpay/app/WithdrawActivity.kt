package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext


class WithdrawActivity : AppCompatActivity() {

    private val repo = WalletRepository()

    private var selectedCurrency = "USDT"
    private var selectedNetwork = "TRC20"

    private lateinit var etAddress: TextInputEditText
    private lateinit var etAmount: TextInputEditText
    private lateinit var btnWithdraw: MaterialButton
    private lateinit var progressBar: ProgressBar

    private var pendingAddress = ""
    private var pendingAmount = 0.0

    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    submitWithdrawal(pin)
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_withdraw)

        selectedCurrency = intent.getStringExtra("currency") ?: "USDT"

        val btnBack = findViewById<View>(R.id.btnBack)
        val tvCurrency = findViewById<TextView>(R.id.tvCurrency)
        val tvNetwork = findViewById<TextView>(R.id.tvNetwork)

        etAddress = findViewById(R.id.etAddress)
        etAmount = findViewById(R.id.etAmount)
        btnWithdraw = findViewById(R.id.btnWithdraw)
        val tvViewHistory = findViewById<TextView>(R.id.tvViewHistory)

        tvViewHistory.setOnClickListener {
            startActivity(
                Intent(this, WithdrawHistoryActivity::class.java)
            )
        }
        progressBar = findViewById(R.id.progressBar)

        tvCurrency.text = selectedCurrency
        tvNetwork.text = selectedNetwork

        btnBack.setOnClickListener { finish() }

        tvCurrency.setOnClickListener {
            showCurrencySheet()
        }

        tvNetwork.setOnClickListener {
            showNetworkSheet()
        }

        btnWithdraw.setOnClickListener {
            validateAndShowReview()
        }
    }

    private fun validateAndShowReview() {
        if (selectedCurrency != "USDT") {
            showComingSoon("Withdrawals for $selectedCurrency are coming soon.")
            return
        }


        val address = etAddress.text?.toString()?.trim().orEmpty()
        val amount = etAmount.text?.toString()?.toDoubleOrNull() ?: 0.0

        if (address.isBlank()) {
            toast("Enter recipient TRON address")
            return
        }

        if (amount <= 0) {
            toast("Enter a valid amount")
            return
        }

        pendingAddress = address
        pendingAmount = amount

        showReviewSheet(address, amount)
    }

    private fun showReviewSheet(address: String, amount: Double) {
        val fee = 1.0
        val total = amount + fee

        val dialog = BottomSheetDialog(this, R.style.JeezPayBottomSheet)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_withdraw_review, null)

        view.findViewById<TextView>(R.id.tvReviewAddress).text = address

        view.findViewById<TextView>(R.id.tvReviewNetwork).text =
            if (selectedNetwork == "TRC20") {
                "TRON (TRC20)"
            } else {
                "BNB Smart Chain (BEP20)"
            }

        view.findViewById<TextView>(R.id.tvReviewAmount).text =
            "$amount USDT"

        view.findViewById<TextView>(R.id.tvReviewFee).text =
            "$fee USDT"

        view.findViewById<TextView>(R.id.tvReviewTotal).text =
            "$total USDT"

        view.findViewById<MaterialButton>(R.id.btnConfirmWithdrawal).setOnClickListener {
            dialog.dismiss()

            pinLauncher.launch(
                Intent(this, PinVerifyActivity::class.java)
            )
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun submitWithdrawal(pin: String) {
        progressBar.visibility = View.VISIBLE
        btnWithdraw.isEnabled = false

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.cryptoWithdrawSafe(
                    toAddress = pendingAddress,
                    amount = pendingAmount,
                    pin = pin,
                    network = selectedNetwork
                )
            }) {
                is ApiResult.Success -> {
                    progressBar.visibility = View.GONE
                    btnWithdraw.isEnabled = true

                    showSuccessSheet(
                        amount = result.data.amount ?: pendingAmount,
                        reference = result.data.reference,
                        txHash = result.data.txHash
                    )
                }

                is ApiResult.Error -> {
                    progressBar.visibility = View.GONE
                    btnWithdraw.isEnabled = true
                    toast(result.error.toString())
                }
            }
        }
    }

    private fun showComingSoon(message: String) {
        val dialog = com.google.android.material.bottomsheet.BottomSheetDialog(this)

        val view = layoutInflater.inflate(
            R.layout.bottom_sheet_coming_soon,
            null
        )

        view.findViewById<TextView>(R.id.tvComingSoonMessage).text = message

        view.findViewById<View>(R.id.btnComingSoonClose).setOnClickListener {
            dialog.dismiss()
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun showNetworkSheet() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_network_picker, null)

        view.findViewById<View>(R.id.rowTrc20).setOnClickListener {
            selectedNetwork = "TRC20"
            findViewById<TextView>(R.id.tvNetwork).text = selectedNetwork
            dialog.dismiss()
        }

        view.findViewById<View>(R.id.rowBep20).setOnClickListener {
            selectedNetwork = "BEP20"
            findViewById<TextView>(R.id.tvNetwork).text = selectedNetwork
            dialog.dismiss()
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun showCurrencySheet() {
        val dialog = BottomSheetDialog(this, R.style.JeezPayBottomSheet)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_currency_picker, null)

        view.findViewById<View>(R.id.rowUsdt).setOnClickListener {
            selectedCurrency = "USDT"
            findViewById<TextView>(R.id.tvCurrency).text = selectedCurrency
            dialog.dismiss()
        }

        view.findViewById<View>(R.id.rowSdg).setOnClickListener {
            dialog.dismiss()
            showComingSoon("SDG withdrawals will be available in a future JeezPay update.")
        }

        view.findViewById<View>(R.id.rowSsp).setOnClickListener {
            dialog.dismiss()
            showComingSoon("SSP withdrawals will be available in a future JeezPay update.")
        }

        view.findViewById<View>(R.id.rowEgp).setOnClickListener {
            dialog.dismiss()
            showComingSoon("EGP withdrawals will be available in a future JeezPay update.")
        }

        view.findViewById<View>(R.id.rowUgx).setOnClickListener {
            dialog.dismiss()
            showComingSoon("UGX withdrawals will be available in a future JeezPay update.")
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun showSuccessSheet(amount: Double, reference: Long?, txHash: String?) {
        val dialog = BottomSheetDialog(this, R.style.JeezPayBottomSheet)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_withdraw_success, null)

        view.findViewById<TextView>(R.id.tvSuccessMessage).text =
            "$amount USDT withdrawal has been submitted successfully."

        view.findViewById<TextView>(R.id.tvSuccessReference).text =
            "Reference: ${reference ?: "-"}\nTransaction hash: ${txHash ?: "Processing"}"

        view.findViewById<MaterialButton>(R.id.btnSuccessDone).setOnClickListener {
            dialog.dismiss()
            finish()
        }

        dialog.setContentView(view)
        dialog.show()
    }
}