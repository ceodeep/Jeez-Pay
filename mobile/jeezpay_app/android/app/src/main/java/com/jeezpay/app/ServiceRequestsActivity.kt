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
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.network.dto.ServiceRequestDto
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

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
            showRequestDetails(request)
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

    private fun showRequestDetails(request: ServiceRequestDto) {
        val status = friendlyText(request.status ?: "pending")
        val service = friendlyServiceName(request.service_type)
        val amount = "${formatAmount(request.amount)} ${request.currency ?: "USDT"}"

        val details = buildString {
            appendLine("Service")
            appendLine(service)
            appendLine()

            appendLine("Status")
            appendLine(status)
            appendLine()

            appendLine("Amount")
            appendLine(amount)
            appendLine()

            appendLine("Provider")
            appendLine(request.provider ?: "-")
            appendLine()

            appendLine("Customer Reference")
            appendLine(request.customer_reference ?: "-")
            appendLine()

            if (!request.note.isNullOrBlank()) {
                appendLine("Your Note")
                appendLine(request.note)
                appendLine()
            }

            if (!request.admin_note.isNullOrBlank()) {
                val label = if ((request.status ?: "").lowercase(Locale.US) == "rejected") {
                    "Rejection Reason"
                } else {
                    "Admin Note"
                }

                appendLine(label)
                appendLine(request.admin_note)
                appendLine()
            }

            appendLine("Transaction Reference")
            appendLine(request.transaction_reference ?: "-")
            appendLine()

            appendLine("Created")
            appendLine(formatDate(request.created_at))

            if (!request.completed_at.isNullOrBlank()) {
                appendLine()
                appendLine("Completed")
                appendLine(formatDate(request.completed_at))
            }

            if (!request.rejected_at.isNullOrBlank()) {
                appendLine()
                appendLine("Rejected")
                appendLine(formatDate(request.rejected_at))
            }
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Request Details")
            .setMessage(details)
            .setPositiveButton("Close", null)
            .show()
    }

    private fun friendlyServiceName(type: String?): String {
        return when (type?.trim()?.lowercase(Locale.US)) {
            "starlink" -> "Starlink Subscription"
            "telecom" -> "Telecom Service"
            "electricity" -> "Electricity Payment"
            "internet" -> "Internet Package"
            else -> "Service Request"
        }
    }

    private fun friendlyText(value: String?): String {
        return value
            ?.trim()
            ?.replace("_", " ")
            ?.replaceFirstChar {
                if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString()
            }
            ?: "-"
    }

    private fun formatAmount(value: Double?): String {
        val amount = value ?: 0.0
        return if (amount % 1.0 == 0.0) {
            amount.toLong().toString()
        } else {
            String.format(Locale.US, "%.2f", amount)
        }
    }

    private fun formatDate(value: String?): String {
        if (value.isNullOrBlank()) return "-"

        val inputFormats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX"
        )

        for (pattern in inputFormats) {
            try {
                val input = SimpleDateFormat(pattern, Locale.US)
                input.timeZone = TimeZone.getTimeZone("UTC")

                val date = input.parse(value) ?: continue

                val output = SimpleDateFormat("dd MMM yyyy • hh:mm a", Locale.US)
                return output.format(date)
            } catch (_: Exception) {
                // Try next format
            }
        }

        return value
    }
}