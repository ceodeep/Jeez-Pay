package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.adapters.CryptoDepositsAdapter
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.launch

class CryptoDepositsActivity : BaseFintechActivity() {

    private val repo = WalletRepository()

    private lateinit var btnBack: View
    private lateinit var rvDeposits: RecyclerView
    private lateinit var progressBar: View
    private lateinit var tvEmpty: TextView

    private lateinit var adapter: CryptoDepositsAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_crypto_deposits)

        btnBack = findViewById(R.id.btnBack)
        rvDeposits = findViewById(R.id.rvDeposits)
        progressBar = findViewById(R.id.progressBar)
        tvEmpty = findViewById(R.id.tvEmpty)

        adapter = CryptoDepositsAdapter { deposit ->
            val tx = deposit.tx_hash ?: "-"
            Toast.makeText(this, tx, Toast.LENGTH_LONG).show()
        }

        rvDeposits.layoutManager = LinearLayoutManager(this)
        rvDeposits.adapter = adapter

        btnBack.setOnClickListener { finish() }

        loadDeposits()
    }

    private fun loadDeposits() {
        setLoading(true)
        tvEmpty.visibility = View.GONE

        lifecycleScope.launch {
            when (val result = repo.cryptoDepositsSafe("USDT", "TRON")) {
                is ApiResult.Success -> {
                    setLoading(false)

                    val deposits = result.data.deposits
                    adapter.submit(deposits)

                    tvEmpty.text = "No USDT deposits yet."
                    tvEmpty.visibility = if (deposits.isEmpty()) View.VISIBLE else View.GONE
                }

                is ApiResult.Error -> {
                    setLoading(false)

                    adapter.submit(emptyList())
                    tvEmpty.text = errorMessage(result.error)
                    tvEmpty.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
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