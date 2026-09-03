package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.adapters.TransactionsAdapter
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class TransactionsActivity : BaseFintechActivity() {

    private val repo = WalletRepository()
    private val productRepo = ProductRepository()

    private lateinit var btnBack: View
    private lateinit var tvCurrency: TextView
    private lateinit var btnChangeCurrency: TextView
    private lateinit var rvTransactions: RecyclerView
    private lateinit var progressBar: View
    private lateinit var tvError: TextView

    private lateinit var adapter: TransactionsAdapter

    private var currencies: Array<String> = emptyArray()
    private var selectedCurrency = ""
    private var productPolicyLoading = false
    private var productPolicyReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_transactions)

        btnBack = findViewById(R.id.btnBack)
        tvCurrency = findViewById(R.id.tvCurrency)
        btnChangeCurrency = findViewById(R.id.btnChangeCurrency)
        rvTransactions = findViewById(R.id.rvTransactions)
        progressBar = findViewById(R.id.progressBar)
        tvError = findViewById(R.id.tvError)

        adapter = TransactionsAdapter("") { tx ->
            if (selectedCurrency.isBlank()) return@TransactionsAdapter

            TransactionDetailsBottomSheet(
                tx = tx,
                displayCurrency = selectedCurrency
            ).show(supportFragmentManager, "TransactionDetailsBottomSheet")
        }

        rvTransactions.layoutManager = LinearLayoutManager(this)
        rvTransactions.adapter = adapter

        btnBack.setOnClickListener {
            finish()
        }

        btnChangeCurrency.setOnClickListener {
            showCurrencyPicker()
        }

        tvCurrency.text = "Wallet: --"
        setLoading(true)
        loadProductPolicy()
    }

    private fun loadProductPolicy(forceRefresh: Boolean = false) {
        if (productPolicyLoading) return

        val cached = ProductPolicyStore.current()
        if (!forceRefresh && cached != null) {
            applyProductPolicy(cached)
            return
        }

        productPolicyLoading = true
        productPolicyReady = false
        setLoading(true)

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    productPolicyLoading = false
                    ProductPolicyStore.replace(result.data)
                    applyProductPolicy(result.data)
                }

                is ApiResult.Error -> {
                    productPolicyLoading = false
                    productPolicyReady = false
                    ProductPolicyStore.clear(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
                    currencies = emptyArray()
                    selectedCurrency = ""
                    tvCurrency.text = "Wallet: --"
                    adapter.showEmpty()
                    setLoading(false)
                    showError(errorMessage(result.error))
                }
            }
        }
    }

    private fun applyProductPolicy(config: ProductCapabilitiesResponse) {
        ProductPolicyStore.replace(config)

        currencies = ProductPolicyStore.enabledCurrencies().toTypedArray()
        if (currencies.isEmpty()) {
            productPolicyReady = false
            selectedCurrency = ""
            tvCurrency.text = "Wallet: --"
            adapter.showEmpty()
            setLoading(false)
            showError("No wallet product is currently available")
            return
        }

        val requestedCurrency = intent.getStringExtra("currency")
            ?.trim()
            ?.uppercase()
            ?.takeIf { it in currencies }

        val defaultCurrency = ProductPolicyStore.defaultCurrency()
            ?.takeIf { it in currencies }

        selectedCurrency = requestedCurrency
            ?: defaultCurrency
            ?: currencies.first()

        productPolicyReady = true
        applyCurrency()
        loadTransactions()
    }

    private fun showCurrencyPicker() {
        if (!productPolicyReady) {
            showError("Wallet products are unavailable")
            return
        }

        if (currencies.size <= 1) return

        val checked = currencies.indexOf(selectedCurrency).coerceAtLeast(0)

        MaterialAlertDialogBuilder(this)
            .setTitle("Choose wallet")
            .setSingleChoiceItems(currencies, checked) { dialog, which ->
                dialog.dismiss()
                selectedCurrency = currencies[which]
                applyCurrency()
                loadTransactions()
            }
            .show()
    }

    private fun applyCurrency() {
        tvCurrency.text = "Wallet: $selectedCurrency"
        adapter.setCurrency(selectedCurrency)
        btnChangeCurrency.isEnabled = productPolicyReady && currencies.size > 1
        btnChangeCurrency.alpha = if (btnChangeCurrency.isEnabled) 1f else 0.6f
    }

    private fun loadTransactions() {
        if (!productPolicyReady ||
            selectedCurrency.isBlank() ||
            !ProductPolicyStore.isCurrencyEnabled(selectedCurrency)
        ) {
            setLoading(false)
            adapter.showEmpty()
            showError("This wallet is not available right now")
            return
        }

        setLoading(true)
        tvError.visibility = View.GONE
        adapter.showSkeleton()

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.fetchHistorySafe(selectedCurrency)
            }) {
                is ApiResult.Success -> {
                    setLoading(false)

                    val list = result.data.transactions ?: emptyList()
                    android.util.Log.d("TX_HISTORY", list.joinToString("\n") {
                        "${it.type} | ${it.amount} | ${it.description} | ref=${it.reference}"
                    })

                    adapter.submit(list)

                    if (list.isEmpty()) {
                        tvError.text = "No transactions yet"
                        tvError.visibility = View.VISIBLE
                    }
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    adapter.showEmpty()
                    showError(errorMessage(result.error))
                }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        btnChangeCurrency.isEnabled =
            !loading && productPolicyReady && currencies.size > 1
        btnChangeCurrency.alpha = if (btnChangeCurrency.isEnabled) 1f else 0.6f
    }

    private fun showError(message: String) {
        tvError.text = message
        tvError.visibility = View.VISIBLE
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun errorMessage(error: AppError): String {
        return when (error) {
            is AppError.NoInternet -> "No internet connection"
            is AppError.Server -> error.message
            is AppError.Unauthorized -> error.message
            is AppError.Validation -> error.message
            is AppError.Unknown -> error.message
        }
    }
}
