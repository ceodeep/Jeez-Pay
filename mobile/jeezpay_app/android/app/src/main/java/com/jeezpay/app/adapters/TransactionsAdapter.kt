package com.jeezpay.app

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class TransactionsAdapter(
    private val items: List<TransactionItem>
) : RecyclerView.Adapter<TransactionsAdapter.VH>() {

    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val merchant: TextView = v.findViewById(R.id.tvMerchant)
        val mask: TextView = v.findViewById(R.id.tvMask)
        val time: TextView = v.findViewById(R.id.tvTime)
        val amount: TextView = v.findViewById(R.id.tvAmount)
        val status: TextView = v.findViewById(R.id.tvStatus)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_transaction, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(h: VH, position: Int) {
        val it = items[position]
        h.merchant.text = it.merchant
        h.mask.text = it.cardMask
        h.time.text = it.time
        h.amount.text = it.amount
        h.status.text = it.status
    }

    override fun getItemCount() = items.size
}
