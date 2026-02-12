package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.R
import com.jeezpay.app.network.dto.TransactionDto
import kotlin.math.abs

class TransactionsAdapter : RecyclerView.Adapter<TransactionsAdapter.TxViewHolder>() {

    private val items = mutableListOf<TransactionDto>()

    fun submit(list: List<TransactionDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TxViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_transaction, parent, false)
        return TxViewHolder(view)
    }

    override fun onBindViewHolder(holder: TxViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class TxViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {

        // ✅ LOCKED IDs (matches your XML)
        private val tvTitle: TextView = itemView.findViewById(R.id.tvTitle)
        private val tvAmount: TextView = itemView.findViewById(R.id.tvAmount)
        private val tvDesc: TextView = itemView.findViewById(R.id.tvDesc)
        private val tvDate: TextView = itemView.findViewById(R.id.tvDate)

        fun bind(tx: TransactionDto) {
            val type = (tx.type ?: "").trim().lowercase()

            // Title: Credit / Debit / ...
            tvTitle.text = type.replaceFirstChar { it.uppercase() }.ifBlank { "Transaction" }

            // Desc
            tvDesc.text = (tx.description ?: "—").trim()

            // Amount
            val amt = tx.amount ?: 0.0
            val sign = if (type == "debit") "-" else "+"
            tvAmount.text = "$sign ${"%.2f".format(abs(amt))}"

            // Date
            tvDate.text = formatTxDate(tx.created_at)
        }

        // ✅ Put it INSIDE ViewHolder so it resolves
        private fun formatTxDate(raw: String?): String {
            if (raw.isNullOrBlank()) return ""

            return try {
                // Backend format: 2026-02-11T00:00:00Z
                val input = java.text.SimpleDateFormat(
                    "yyyy-MM-dd'T'HH:mm:ss'Z'",
                    java.util.Locale.US
                )
                input.timeZone = java.util.TimeZone.getTimeZone("UTC")

                val date = input.parse(raw)

                val output = java.text.SimpleDateFormat(
                    "MMM dd, yyyy • hh:mm a",
                    java.util.Locale.getDefault()
                )

                output.format(date!!)
            } catch (e: Exception) {
                raw // fallback if parsing fails
            }
        }

    }
}
