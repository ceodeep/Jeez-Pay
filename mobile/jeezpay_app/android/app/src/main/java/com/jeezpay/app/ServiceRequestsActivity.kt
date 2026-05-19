package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.adapters.ServiceRequestsAdapter
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.repository.ServicesRepository
import kotlinx.coroutines.launch

class ServiceRequestsActivity : BaseFintechActivity() {

    private val repo = ServicesRepository()

    private lateinit var btnBack: View
    private lateinit var rvRequests: RecyclerView
    private lateinit var progressBar: View
    private lateinit var tvEmpty: TextView

    private lateinit var adapter: ServiceRequestsAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_service_requests)

        btnBack = findViewById(R.id.btnBack)
        rvRequests = findViewById(R.id.rvRequests)
        progressBar = findViewById(R.id.progressBar)
        tvEmpty = findViewById(R.id.tvEmpty)

        adapter = ServiceRequestsAdapter { request ->
            Toast.makeText(
                this,
                request.transaction_reference ?: "Service request",
                Toast.LENGTH_LONG
            ).show()
        }

        rvRequests.layoutManager = LinearLayoutManager(this)
        rvRequests.adapter = adapter

        btnBack.setOnClickListener { finish() }

        loadRequests()
    }

    override fun onResume() {
        super.onResume()
        loadRequests()
    }

    private fun loadRequests() {
        setLoading(true)
        tvEmpty.visibility = View.GONE

        lifecycleScope.launch {
            when (val result = repo.myRequestsSafe()) {
                is ApiResult.Success -> {
                    setLoading(false)

                    val requests = result.data.requests
                    adapter.submit(requests)

                    tvEmpty.text = "No service requests yet."
                    tvEmpty.visibility = if (requests.isEmpty()) View.VISIBLE else View.GONE
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