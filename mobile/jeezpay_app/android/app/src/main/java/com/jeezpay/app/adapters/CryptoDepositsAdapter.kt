package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.R
import com.jeezpay.app.network.dto.CryptoDepositDto
import java.text.DecimalFormat

class CryptoDepositsAdapter(
    private val onClick: ((CryptoDepositDto) -> Unit)? = null
) : RecyclerView.Adapter<CryptoDepositsAdapter.VH>() {

    private val items = mutableListOf<CryptoDepositDto>()
    private val df = DecimalFormat("#,##0.######")

    fun submit(list: List<CryptoDepositDto>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    class VH(parent: ViewGroup) : RecyclerView.ViewHolder(
        LayoutInflater.from(parent.context).inflate(
            R.layout.item_crypto_deposit,
            parent,
            false
        )
    ) {
        val tvDepositAmount: TextView = itemView.findViewById(R.id.tvDepositAmount)
        val tvDepositStatus: TextView = itemView.findViewById(R.id.tvDepositStatus)
        val tvDepositNetwork: TextView = itemView.findViewById(R.id.tvDepositNetwork)
        val tvDepositHash: TextView = itemView.findViewById(R.id.tvDepositHash)
        val tvDepositDate: TextView = itemView.findViewById(R.id.tvDepositDate)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH = VH(parent)

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]

        val amount = item.amount ?: 0.0
        val token = item.token ?: "USDT"
        val network = item.network ?: "TRON"
        val status = item.status?.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase() else it.toString()
        } ?: "Pending"

        holder.tvDepositAmount.text = "${df.format(amount)} $token"
        holder.tvDepositStatus.text = status
        holder.tvDepositNetwork.text = "$network • $token"
        holder.tvDepositHash.text = "TX: ${item.tx_hash ?: "-"}"
        holder.tvDepositDate.text = item.credited_at ?: item.created_at ?: "-"

        holder.itemView.setOnClickListener {
            onClick?.invoke(item)
        }
    }
}