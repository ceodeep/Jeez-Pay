package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView
import com.google.android.material.imageview.ShapeableImageView
import com.jeezpay.app.R
import com.jeezpay.app.WalletBalance
import java.text.NumberFormat
import java.util.Locale

class WalletStripAdapter(
    private val items: List<WalletBalance>,
    private var selectedCode: String,
    private val onClick: (WalletBalance) -> Unit
) : RecyclerView.Adapter<WalletStripAdapter.VH>() {

    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    fun setSelected(code: String) {
        selectedCode = code
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_wallet_strip, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.bind(item, item.code == selectedCode, onClick, nf)
    }

    override fun getItemCount(): Int = items.size

    class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val card: MaterialCardView = itemView.findViewById(R.id.card)
        private val img: ShapeableImageView = itemView.findViewById(R.id.img)
        private val tvCode: TextView = itemView.findViewById(R.id.tvCode)
        private val tvAmount: TextView = itemView.findViewById(R.id.tvAmount)
        private val tvName: TextView = itemView.findViewById(R.id.tvName)

        fun bind(
            item: WalletBalance,
            selected: Boolean,
            onClick: (WalletBalance) -> Unit,
            nf: NumberFormat
        ) {
            img.setImageResource(item.iconRes)
            tvCode.text = item.code
            tvName.text = item.name
            tvAmount.text = nf.format(item.amount)

            if (selected) {
                card.setCardBackgroundColor(itemView.context.getColor(R.color.bg_soft_blue))
                card.strokeWidth = 2
                card.strokeColor = itemView.context.getColor(R.color.paypal_blue)
            } else {
                card.setCardBackgroundColor(itemView.context.getColor(R.color.card_white))
                card.strokeWidth = 1
                card.strokeColor = itemView.context.getColor(R.color.card_stroke_soft)
            }

            itemView.setOnClickListener { onClick(item) }
        }
    }
}
