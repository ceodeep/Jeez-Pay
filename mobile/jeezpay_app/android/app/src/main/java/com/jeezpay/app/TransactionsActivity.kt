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
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class TransactionsActivity : BaseFintechActivity() {

    private val repo = WalletRepository()
    private val currencies = arrayOf("USDT", "SDG", "SSP", "EGP", "UGX")

    private lateinit var btnBack: View
    private lateinit var tvCurrency: TextView
    private lateinit var btnChangeCurrency: TextView
    private lateinit var rvTransactions: RecyclerView
    private lateinit var progressBar: View
    private lateinit var tvError: TextView

    private lateinit var adapter: TransactionsAdapter

    private var selectedCurrency = "SSP"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_transactions)

        selectedCurrency = intent.getStringExtra("currency") ?: "SSP"

        btnBack = findViewById(R.id.btnBack)
        tvCurrency = findViewById(R.id.tvCurrency)
        btnChangeCurrency = findViewById(R.id.btnChangeCurrency)
        rvTransactions = findViewById(R.id.rvTransactions)
        progressBar = findViewById(R.id.progressBar)
        tvError = findViewById(R.id.tvError)

        adapter = TransactionsAdapter(selectedCurrency) { tx ->
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

        applyCurrency()
        loadTransactions()
    }

    private fun showCurrencyPicker() {
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
    }

    private fun loadTransactions() {
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

                    val visibleList = list.filterNot { tx ->
                        tx.description?.trim()?.equals("Transfer fee", ignoreCase = true) == true ||
                                tx.type?.trim()?.equals("fee", ignoreCase = true) == true
                    }

                    adapter.submit(visibleList)

                    if (visibleList.isEmpty()) {
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
        btnChangeCurrency.isEnabled = !loading
        btnChangeCurrency.alpha = if (loading) 0.6f else 1f
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