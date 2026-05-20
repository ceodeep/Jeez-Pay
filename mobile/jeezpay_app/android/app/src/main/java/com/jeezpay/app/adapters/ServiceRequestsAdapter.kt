package com.jeezpay.app.adapters

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.R
import com.jeezpay.app.network.dto.ServiceRequestDto
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class ServiceRequestsAdapter(
    private val onClick: ((ServiceRequestDto) -> Unit)? = null
) : RecyclerView.Adapter<ServiceRequestsAdapter.VH>() {

    private val items = mutableListOf<ServiceRequestDto>()
    private val df = DecimalFormat("#,##0.##")

    fun submit(list: List<ServiceRequestDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    class VH(parent: ViewGroup) : RecyclerView.ViewHolder(
        LayoutInflater.from(parent.context).inflate(
            R.layout.item_service_request,
            parent,
            false
        )
    ) {
        val tvServiceTitle: TextView = itemView.findViewById(R.id.tvServiceTitle)
        val tvStatus: TextView = itemView.findViewById(R.id.tvStatus)
        val tvServiceAmount: TextView = itemView.findViewById(R.id.tvServiceAmount)
        val tvServiceProvider: TextView = itemView.findViewById(R.id.tvServiceProvider)
        val tvServiceReference: TextView = itemView.findViewById(R.id.tvServiceReference)
        val tvAdminNote: TextView = itemView.findViewById(R.id.tvAdminNote)
        val tvTransactionReference: TextView = itemView.findViewById(R.id.tvTransactionReference)
        val tvServiceDate: TextView = itemView.findViewById(R.id.tvServiceDate)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH = VH(parent)

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]

        val serviceTitle = friendlyServiceName(item.service_type)
        val statusRaw = item.status?.trim()?.lowercase(Locale.US) ?: "pending"
        val status = friendlyStatus(statusRaw)
        val amount = item.amount ?: 0.0
        val currency = item.currency ?: "USDT"
        val provider = item.provider?.takeIf { it.isNotBlank() } ?: "-"
        val customerReference = item.customer_reference?.takeIf { it.isNotBlank() } ?: "-"
        val txRef = item.transaction_reference?.takeIf { it.isNotBlank() } ?: "-"

        holder.tvServiceTitle.text = serviceTitle
        holder.tvStatus.text = status
        holder.tvServiceAmount.text = "${df.format(amount)} $currency"
        holder.tvServiceProvider.text = "Provider: $provider"
        holder.tvServiceReference.text = "Customer: $customerReference"
        holder.tvTransactionReference.text = "Reference: $txRef"
        holder.tvServiceDate.text = formatDate(item.created_at)

        applyStatusStyle(holder.tvStatus, statusRaw)

        val adminNote = item.admin_note?.trim().orEmpty()
        if (adminNote.isNotBlank()) {
            val label = when (statusRaw) {
                "rejected" -> "Reason"
                "completed" -> "Admin note"
                else -> "Note"
            }

            holder.tvAdminNote.text = "$label: $adminNote"
            holder.tvAdminNote.visibility = View.VISIBLE
        } else {
            holder.tvAdminNote.visibility = View.GONE
        }

        holder.itemView.setOnClickListener {
            onClick?.invoke(item)
        }
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

    private fun friendlyStatus(status: String?): String {
        return status
            ?.trim()
            ?.replace("_", " ")
            ?.replaceFirstChar {
                if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString()
            }
            ?: "Pending"
    }

    private fun applyStatusStyle(view: TextView, status: String) {
        when (status.lowercase(Locale.US)) {
            "completed" -> {
                view.setBackgroundResource(R.drawable.bg_status_completed)
                view.setTextColor(Color.parseColor("#18794E"))
            }

            "rejected" -> {
                view.setBackgroundResource(R.drawable.bg_status_rejected)
                view.setTextColor(Color.parseColor("#C0392B"))
            }

            else -> {
                view.setBackgroundResource(R.drawable.bg_status_pending)
                view.setTextColor(Color.parseColor("#B26A00"))
            }
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