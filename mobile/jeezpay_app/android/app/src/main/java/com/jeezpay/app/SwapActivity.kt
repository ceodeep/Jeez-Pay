package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DecimalFormat


class SwapActivity : BaseFintechActivity() {

    private val repo = WalletRepository()
    private val df = DecimalFormat("#,##0.##")
    private val currencies = arrayOf("USDT", "SDG", "SSP", "EGP", "UGX")

    private lateinit var btnBack: View
    private lateinit var fromCurrencyBox: LinearLayout
    private lateinit var toCurrencyBox: LinearLayout
    private lateinit var tvFromCurrency: TextView
    private lateinit var tvToCurrency: TextView
    private lateinit var tvFromBalance: TextView
    private lateinit var tvToBalance: TextView
    private lateinit var etAmount: EditText
    private lateinit var tvReceiveAmount: TextView
    private lateinit var tvRate: TextView
    private lateinit var tvFee: TextView
    private lateinit var tvTotalDebit: TextView
    private lateinit var tvError: TextView
    private lateinit var btnPreview: TextView
    private lateinit var btnReview: TextView

    private var fromCurrency = "USDT"
    private var toCurrency = "SSP"

    private var previewAmount = 0.0
    private var previewRate = 0.0
    private var previewFee = 0.0
    private var previewTotalDebit = 0.0
    private var previewReceiveAmount = 0.0

    private val balances = mutableMapOf<String, Double>()

    private var pendingPinAction: ((String) -> Unit)? = null

    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    pendingPinAction?.invoke(pin)
                }
            }
            pendingPinAction = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_swap)

        bindViews()
        bindClicks()
        loadBalances()
        resetPreview()
    }

    private fun bindViews() {
        btnBack = findViewById(R.id.btnBack)
        fromCurrencyBox = findViewById(R.id.fromCurrencyBox)
        toCurrencyBox = findViewById(R.id.toCurrencyBox)
        tvFromCurrency = findViewById(R.id.tvFromCurrency)
        tvToCurrency = findViewById(R.id.tvToCurrency)
        tvFromBalance = findViewById(R.id.tvFromBalance)
        tvToBalance = findViewById(R.id.tvToBalance)
        etAmount = findViewById(R.id.etAmount)
        tvReceiveAmount = findViewById(R.id.tvReceiveAmount)
        tvRate = findViewById(R.id.tvRate)
        tvFee = findViewById(R.id.tvFee)
        tvTotalDebit = findViewById(R.id.tvTotalDebit)
        tvError = findViewById(R.id.tvError)
        btnPreview = findViewById(R.id.btnPreview)
        btnReview = findViewById(R.id.btnReview)
    }

    private fun bindClicks() {
        btnBack.setOnClickListener { finish() }

        fromCurrencyBox.setOnClickListener {
            chooseCurrency("From currency", fromCurrency) {
                fromCurrency = it
                if (fromCurrency == toCurrency) {
                    toCurrency = currencies.first { c -> c != fromCurrency }
                }
                applyCurrencies()
                resetPreview()
            }
        }

        toCurrencyBox.setOnClickListener {
            chooseCurrency("To currency", toCurrency) {
                toCurrency = it
                if (fromCurrency == toCurrency) {
                    showError("Choose two different currencies")
                    return@chooseCurrency
                }
                applyCurrencies()
                resetPreview()
            }
        }

        btnPreview.setOnClickListener {
            previewSwap()
        }

        btnReview.setOnClickListener {
            showReviewSheet()
        }
    }

    private fun chooseCurrency(title: String, current: String, onPicked: (String) -> Unit) {
        val checked = currencies.indexOf(current).coerceAtLeast(0)

        MaterialAlertDialogBuilder(this)
            .setTitle(title)
            .setSingleChoiceItems(currencies, checked) { dialog, which ->
                dialog.dismiss()
                onPicked(currencies[which])
            }
            .show()
    }

    private fun applyCurrencies() {
        tvFromCurrency.text = fromCurrency
        tvToCurrency.text = toCurrency

        tvFromBalance.text = "Balance: ${df.format(balances[fromCurrency] ?: 0.0)}"
        tvToBalance.text = "Balance: ${df.format(balances[toCurrency] ?: 0.0)}"
    }

    private fun loadBalances() {
        setLoading(true)

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.fetchBalancesSafe()
            }) {
                is ApiResult.Success -> {
                    balances.clear()
                    result.data.balances.forEach {
                        balances[it.currency] = it.balance
                    }

                    setLoading(false)
                    applyCurrencies()
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    handleSwapError(result.error)
                }
            }
        }
    }

    private fun previewSwap() {
        val amount = etAmount.text.toString().trim().toDoubleOrNull()

        if (amount == null || amount <= 0) {
            showError("Enter a valid amount")
            return
        }

        if (fromCurrency == toCurrency) {
            showError("Choose two different currencies")
            return
        }


        val balance = balances[fromCurrency] ?: 0.0
        if (amount > balance) {
            showError("Insufficient balance")
            return
        }

        setLoading(true)
        tvError.visibility = View.GONE

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.swapPreviewSafe(
                    fromCurrency = fromCurrency,
                    toCurrency = toCurrency,
                    amount = amount
                )
            }) {
                is ApiResult.Success -> {
                    setLoading(false)

                    val res = result.data
                    previewAmount = res.amount ?: amount
                    previewRate = res.rate ?: 0.0
                    previewFee = res.fee ?: 0.0
                    previewTotalDebit = res.totalDebit ?: 0.0
                    previewReceiveAmount = res.receiveAmount ?: 0.0

                    tvReceiveAmount.text =
                        "You receive: ${df.format(previewReceiveAmount)} $toCurrency"
                    tvRate.text =
                        "Rate: 1 $fromCurrency = ${df.format(previewRate)} $toCurrency"
                    tvFee.text =
                        "Fee: ${df.format(previewFee)} $fromCurrency"
                    tvTotalDebit.text =
                        "Total deducted: ${df.format(previewTotalDebit)} $fromCurrency"

                    setReviewEnabled(true)
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    resetPreview()
                    handleSwapError(result.error)
                }
            }
        }
    }

    private fun showReviewSheet() {
        if (previewAmount <= 0 || previewRate <= 0) {
            showError("Preview swap first")
            return
        }

        SwapReviewBottomSheet(
            fromCurrency = fromCurrency,
            toCurrency = toCurrency,
            amount = previewAmount,
            rate = previewRate,
            fee = previewFee,
            totalDebit = previewTotalDebit,
            receiveAmount = previewReceiveAmount
        ) {
            openPinThenConfirm { pin ->
                confirmSwap(pin)
            }
        }.show(supportFragmentManager, "SwapReviewBottomSheet")
    }

    private fun openPinThenConfirm(onConfirmAfterPin: (String) -> Unit) {
        pendingPinAction = onConfirmAfterPin

        val i = Intent(this, PinVerifyActivity::class.java).apply {
            putExtra(PinVerifyActivity.EXTRA_TITLE, "Enter your PIN")
            putExtra(PinVerifyActivity.EXTRA_SUBTITLE, "Confirm this swap with your transaction PIN")
        }

        pinLauncher.launch(i)
    }

    private fun confirmSwap(pin: String) {
        setLoading(true)

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.swapConfirmSafe(
                    fromCurrency = fromCurrency,
                    toCurrency = toCurrency,
                    amount = previewAmount,
                    pin = pin
                )
            }) {
                is ApiResult.Success -> {
                    setLoading(false)

                    val res = result.data

                    val i = Intent(this@SwapActivity, SwapReceiptActivity::class.java).apply {
                        putExtra("reference", res.reference ?: "-")
                        putExtra("fromCurrency", res.fromCurrency ?: fromCurrency)
                        putExtra("toCurrency", res.toCurrency ?: toCurrency)
                        putExtra("amount", res.amount ?: previewAmount)
                        putExtra("receiveAmount", res.receiveAmount ?: previewReceiveAmount)
                        putExtra("rate", res.rate ?: previewRate)
                    }

                    startActivity(i)
                    finish()
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    handleSwapError(result.error)
                }
            }
        }
    }

    private fun resetPreview() {
        previewAmount = 0.0
        previewRate = 0.0
        previewFee = 0.0
        previewTotalDebit = 0.0
        previewReceiveAmount = 0.0

        tvReceiveAmount.text = "You receive: -"
        tvRate.text = "Rate: -"
        tvFee.text = "Fee: -"
        tvTotalDebit.text = "Total deducted: -"

        setReviewEnabled(false)
    }

    private fun setReviewEnabled(enabled: Boolean) {
        btnReview.isEnabled = enabled
        btnReview.alpha = if (enabled) 1f else 0.55f
    }

    private fun setLoading(loading: Boolean) {
        btnPreview.isEnabled = !loading
        btnPreview.alpha = if (loading) 0.7f else 1f
        btnPreview.text = if (loading) "Please wait..." else "Preview Swap"

        btnReview.isEnabled = !loading && previewAmount > 0
        btnReview.alpha = if (btnReview.isEnabled) 1f else 0.55f

        etAmount.isEnabled = !loading
        fromCurrencyBox.isEnabled = !loading
        toCurrencyBox.isEnabled = !loading
    }

    private fun handleSwapError(error: AppError) {
        val message = when (error) {
            is AppError.NoInternet -> "No internet connection"
            is AppError.Server -> error.message
            is AppError.Unauthorized -> error.message
            is AppError.Validation -> error.message
            is AppError.Unknown -> error.message
        }

        showError(message)
    }

    private fun showError(message: String) {
        tvError.text = message
        tvError.visibility = View.VISIBLE
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}