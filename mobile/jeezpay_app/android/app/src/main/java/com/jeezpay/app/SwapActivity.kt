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
import com.jeezpay.app.network.dto.ProductCapability
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DecimalFormat

class SwapActivity : BaseFintechActivity() {

    private val repo = WalletRepository()
    private val productRepo = ProductRepository()
    private val df = DecimalFormat("#,##0.##")

    private var currencies: Array<String> = emptyArray()
    private var swapPolicyReady = false
    private var swapPolicyLoading = false

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

    private var fromCurrency = ""
    private var toCurrency = ""

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
        resetPreview()
        applyUnavailableCurrencyUi()
        setLoading(false)
        loadSwapPolicy()
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
            if (!requireSwapPolicy()) return@setOnClickListener

            chooseCurrency("From currency", fromCurrency) {
                fromCurrency = it
                if (fromCurrency == toCurrency) {
                    toCurrency = currencies.first { currency -> currency != fromCurrency }
                }
                applyCurrencies()
                resetPreview()
            }
        }

        toCurrencyBox.setOnClickListener {
            if (!requireSwapPolicy()) return@setOnClickListener

            chooseCurrency("To currency", toCurrency) {
                if (fromCurrency == it) {
                    showError("Choose two different currencies")
                    return@chooseCurrency
                }

                toCurrency = it
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

    private fun loadSwapPolicy(forceRefresh: Boolean = false) {
        if (swapPolicyLoading) return

        val cached = ProductPolicyStore.current()
        if (!forceRefresh && cached != null) {
            applySwapPolicy(cached)
            return
        }

        swapPolicyLoading = true
        swapPolicyReady = false
        setLoading(false)
        showBlockingLoader()

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    swapPolicyLoading = false
                    ProductPolicyStore.replace(result.data)
                    applySwapPolicy(result.data)
                }

                is ApiResult.Error -> {
                    swapPolicyLoading = false
                    swapPolicyReady = false
                    ProductPolicyStore.clear(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
                    hideBlockingLoader()
                    failSwapPolicy("Currency exchange is not available right now")
                    handleSwapError(result.error)
                }
            }
        }
    }

    private fun applySwapPolicy(config: ProductCapabilitiesResponse) {
        ProductPolicyStore.replace(config)

        val allowedCurrencies = ProductPolicyStore
            .currenciesWithCapability(ProductCapability.FX_CONVERT)

        if (allowedCurrencies.size < 2) {
            hideBlockingLoader()
            failSwapPolicy("Currency exchange is not available right now")
            return
        }

        currencies = allowedCurrencies.toTypedArray()

        val requestedFrom = intent.getStringExtra("fromCurrency")
            ?.trim()
            ?.uppercase()
            ?.takeIf { it in currencies }

        val requestedTo = intent.getStringExtra("toCurrency")
            ?.trim()
            ?.uppercase()
            ?.takeIf { it in currencies && it != requestedFrom }

        fromCurrency = requestedFrom ?: currencies[0]
        toCurrency = requestedTo
            ?: currencies.first { it != fromCurrency }

        swapPolicyReady = true
        hideBlockingLoader()
        applyCurrencies()
        resetPreview()
        setLoading(false)
        loadBalances()
    }

    private fun failSwapPolicy(message: String) {
        swapPolicyLoading = false
        swapPolicyReady = false
        currencies = emptyArray()
        fromCurrency = ""
        toCurrency = ""
        balances.clear()
        applyUnavailableCurrencyUi()
        resetPreview()
        setLoading(false)
        showError(message)
    }

    private fun requireSwapPolicy(): Boolean {
        val allowed = swapPolicyReady &&
            fromCurrency.isNotBlank() &&
            toCurrency.isNotBlank() &&
            fromCurrency != toCurrency &&
            ProductPolicyStore.isCapabilityEnabled(
                fromCurrency,
                ProductCapability.FX_CONVERT
            ) &&
            ProductPolicyStore.isCapabilityEnabled(
                toCurrency,
                ProductCapability.FX_CONVERT
            )

        if (!allowed) {
            showError("Currency exchange is not available right now")
        }

        return allowed
    }

    private fun chooseCurrency(title: String, current: String, onPicked: (String) -> Unit) {
        if (!swapPolicyReady || currencies.isEmpty()) return

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

    private fun applyUnavailableCurrencyUi() {
        tvFromCurrency.text = "--"
        tvToCurrency.text = "--"
        tvFromBalance.text = "Balance: --"
        tvToBalance.text = "Balance: --"
    }

    private fun loadBalances() {
        if (!requireSwapPolicy()) return

        setLoading(true)

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.fetchBalancesSafe()
            }) {
                is ApiResult.Success -> {
                    balances.clear()
                    result.data.balances.forEach {
                        balances[it.currency.trim().uppercase()] = it.balance
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
        if (!requireSwapPolicy()) return

        val amount = etAmount.text.toString().trim().toDoubleOrNull()

        if (amount == null || amount <= 0) {
            showError("Enter a valid amount")
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
                    if (!requireSwapPolicy()) {
                        setLoading(false)
                        return@launch
                    }

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
        if (!requireSwapPolicy()) return

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
        if (!requireSwapPolicy()) return

        pendingPinAction = onConfirmAfterPin

        val i = Intent(this, PinVerifyActivity::class.java).apply {
            putExtra(PinVerifyActivity.EXTRA_TITLE, "Enter your PIN")
            putExtra(PinVerifyActivity.EXTRA_SUBTITLE, "Confirm this swap with your transaction PIN")
        }

        pinLauncher.launch(i)
    }

    private fun confirmSwap(pin: String) {
        if (!requireSwapPolicy()) return

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
        val canReview = enabled && swapPolicyReady
        btnReview.isEnabled = canReview
        btnReview.alpha = if (canReview) 1f else 0.55f
    }

    private fun setLoading(loading: Boolean) {
        val canInteract = !loading && swapPolicyReady

        btnPreview.isEnabled = canInteract
        btnPreview.alpha = if (canInteract) 1f else 0.7f
        btnPreview.text = if (loading) "Please wait..." else "Preview Swap"

        btnReview.isEnabled = canInteract && previewAmount > 0
        btnReview.alpha = if (btnReview.isEnabled) 1f else 0.55f

        etAmount.isEnabled = canInteract
        fromCurrencyBox.isEnabled = canInteract
        toCurrencyBox.isEnabled = canInteract
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
