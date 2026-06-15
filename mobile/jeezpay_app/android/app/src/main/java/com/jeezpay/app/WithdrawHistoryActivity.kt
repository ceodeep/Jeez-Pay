package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.jeezpay.app.adapters.WithdrawalHistoryAdapter

class WithdrawHistoryActivity : BaseFintechActivity() {

    private val repo = WalletRepository()

    private lateinit var btnBack: ImageView
    private lateinit var rvHistory: RecyclerView
    private lateinit var progressBar: View
    private lateinit var tvEmpty: TextView

    private lateinit var adapter: WithdrawalHistoryAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_withdraw_history)

        btnBack = findViewById(R.id.btnBack)
        rvHistory = findViewById(R.id.rvHistory)
        progressBar = findViewById(R.id.progressBar)
        tvEmpty = findViewById(R.id.tvEmpty)

        adapter = WithdrawalHistoryAdapter { withdrawal ->

            WithdrawalDetailsBottomSheet(withdrawal)
                .show(
                    supportFragmentManager,
                    "WithdrawalDetailsBottomSheet"
                )
        }

        rvHistory.layoutManager = LinearLayoutManager(this)
        rvHistory.adapter = adapter

        btnBack.setOnClickListener {
            finish()
        }

        loadHistory()
    }

    private fun loadHistory() {

        progressBar.visibility = View.VISIBLE
        tvEmpty.visibility = View.GONE

        lifecycleScope.launch {

            when (
                val result = withContext(Dispatchers.IO) {
                    repo.cryptoWithdrawalsSafe()
                }
            ) {

                is ApiResult.Success -> {

                    progressBar.visibility = View.GONE

                    val list =
                        result.data.withdrawals ?: emptyList()

                    adapter.submit(list)

                    if (list.isEmpty()) {
                        tvEmpty.visibility = View.VISIBLE
                    }
                }

                is ApiResult.Error -> {

                    progressBar.visibility = View.GONE
                    tvEmpty.visibility = View.VISIBLE
                    tvEmpty.text = "Failed to load withdrawals"
                }
            }
        }
    }
}