package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.R
import com.jeezpay.app.network.dto.WithdrawalDto

class WithdrawalHistoryAdapter(
    private val onClick: (WithdrawalDto) -> Unit
) : RecyclerView.Adapter<WithdrawalHistoryAdapter.VH>() {

    private val items = mutableListOf<WithdrawalDto>()

    fun submit(list: List<WithdrawalDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    inner class VH(parent: ViewGroup) :
        RecyclerView.ViewHolder(
            LayoutInflater.from(parent.context)
                .inflate(R.layout.item_withdrawal, parent, false)
        ) {

        val amount =
            itemView.findViewById<TextView>(R.id.tvAmount)

        val address =
            itemView.findViewById<TextView>(R.id.tvAddress)

        val status =
            itemView.findViewById<TextView>(R.id.tvStatus)
        val network =
            itemView.findViewById<TextView>(R.id.tvNetwork)

        val date =
            itemView.findViewById<TextView>(R.id.tvDate)
    }

    override fun onCreateViewHolder(
        parent: ViewGroup,
        viewType: Int
    ) = VH(parent)

    override fun getItemCount() = items.size

    override fun onBindViewHolder(
        holder: VH,
        position: Int

    ) {

        val item = items[position]

        holder.amount.text =
            "${item.amount ?: 0.0} USDT"

        holder.network.text =
            item.network ?: "TRC20"

        holder.address.text =
            item.to_address ?: "-"

        holder.date.text =
            item.created_at ?: ""

        val status =
            item.status?.lowercase() ?: "pending"

        holder.status.text =
            status.replaceFirstChar { it.uppercase() }

        when (status) {

            "completed" -> {
                holder.status.setBackgroundResource(
                    R.drawable.bg_status_success_soft
                )
                holder.status.setTextColor(
                    holder.itemView.context.getColor(R.color.success)
                )
            }

            "failed" -> {
                holder.status.setBackgroundResource(
                    R.drawable.bg_status_error_soft
                )
                holder.status.setTextColor(
                    holder.itemView.context.getColor(R.color.error_red)
                )
            }

            else -> {
                holder.status.setBackgroundResource(
                    R.drawable.bg_status_pending_soft
                )
                holder.status.setTextColor(
                    holder.itemView.context.getColor(R.color.paypal_blue)
                )
            }
        }
        holder.itemView.setOnClickListener {
            onClick(item)
        }
    }
}