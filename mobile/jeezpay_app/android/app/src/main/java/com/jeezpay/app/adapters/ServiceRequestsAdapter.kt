package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.R
import com.jeezpay.app.network.dto.ServiceRequestDto
import java.text.DecimalFormat
import java.util.Locale

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
        val tvServiceReference: TextView = itemView.findViewById(R.id.tvServiceReference)
        val tvTransactionReference: TextView = itemView.findViewById(R.id.tvTransactionReference)
        val tvServiceDate: TextView = itemView.findViewById(R.id.tvServiceDate)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH = VH(parent)

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]

        val serviceTitle = friendlyServiceName(item.service_type)
        val status = friendlyStatus(item.status)
        val amount = item.amount ?: 0.0
        val currency = item.currency ?: "USDT"

        holder.tvServiceTitle.text = serviceTitle
        holder.tvStatus.text = status
        holder.tvServiceAmount.text = "${df.format(amount)} $currency"
        holder.tvServiceReference.text = "Customer: ${item.customer_reference ?: "-"}"
        holder.tvTransactionReference.text = "Reference: ${item.transaction_reference ?: "-"}"
        holder.tvServiceDate.text = item.created_at ?: "-"

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
            ?.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
            ?: "Pending"
    }
}