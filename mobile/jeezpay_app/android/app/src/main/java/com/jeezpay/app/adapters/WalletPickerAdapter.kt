package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jeezpay.app.R
import com.jeezpay.app.WalletBalance
import java.text.NumberFormat
import java.util.Locale

class WalletPickerAdapter(
    private val items: List<WalletBalance>,
    private val onClick: (WalletBalance) -> Unit
) : RecyclerView.Adapter<WalletPickerAdapter.VH>() {

    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val img: ImageView = v.findViewById(R.id.imgIcon)
        val name: TextView = v.findViewById(R.id.tvName)
        val code: TextView = v.findViewById(R.id.tvCode)
        val amount: TextView = v.findViewById(R.id.tvAmount)
    }

    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_wallet, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(h: VH, position: Int) {
        val item = items[position]

        h.img.setImageResource(item.iconRes)
        h.name.text = item.name
        h.code.text = item.code
        h.amount.text = "${nf.format(item.amount)} ${item.code}"

        // ✅ IMPORTANT: pass WalletBalance (item), NOT the view
        h.itemView.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size
}
