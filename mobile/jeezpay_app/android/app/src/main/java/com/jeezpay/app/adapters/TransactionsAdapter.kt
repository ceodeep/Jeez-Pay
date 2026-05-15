package com.jeezpay.app.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.card.MaterialCardView
import com.jeezpay.app.R
import com.jeezpay.app.network.dto.TransactionDto
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import com.facebook.shimmer.ShimmerFrameLayout

class TransactionsAdapter(
    private var displayCurrency: String = "USDT",
    private val onTransactionClick: ((TransactionDto) -> Unit)? = null
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    // --- list rows: either Header or Tx ---
    private sealed class Row {
        object Skeleton : Row()
        object Empty : Row()
        object LoadingMore : Row()
        data class Header(val title: String) : Row()
        data class Tx(val tx: TransactionDto) : Row()
    }

    private val rows = mutableListOf<Row>()

    private var fullList: List<TransactionDto> = emptyList()
    private var visibleCount = 0
    private val pageSize = 10
    private var hasMoreItems = false

    fun setCurrency(code: String) {
        displayCurrency = code
        notifyDataSetChanged()
    }

    fun submit(list: List<TransactionDto>) {
        fullList = list.sortedByDescending { it.created_at ?: "" }
        visibleCount = minOf(pageSize, fullList.size)
        rebuildRows()
    }

    fun loadNextPage() {
        if (!hasMoreItems) return

        val nextCount = minOf(visibleCount + pageSize, fullList.size)
        if (nextCount == visibleCount) return

        visibleCount = nextCount
        rebuildRows()
    }

    fun canLoadMore(): Boolean = hasMoreItems

    private fun rebuildRows() {
        rows.clear()

        if (fullList.isEmpty()) {
            rows.add(Row.Empty)
            notifyDataSetChanged()
            return
        }

        val visibleItems = fullList.take(visibleCount)

        val today = Calendar.getInstance()
        val yesterday = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }

        val todayKey = dayKey(today.time)
        val yesterdayKey = dayKey(yesterday.time)

        var addedToday = false
        var addedYesterday = false
        var addedEarlier = false

        for (tx in visibleItems) {
            val txDay = parseDayKey(tx.created_at)

            when (txDay) {
                todayKey -> {
                    if (!addedToday) {
                        rows.add(Row.Header("Today"))
                        addedToday = true
                    }
                }
                yesterdayKey -> {
                    if (!addedYesterday) {
                        rows.add(Row.Header("Yesterday"))
                        addedYesterday = true
                    }
                }
                else -> {
                    if (!addedEarlier) {
                        rows.add(Row.Header("Earlier"))
                        addedEarlier = true
                    }
                }
            }

            rows.add(Row.Tx(tx))
        }

        hasMoreItems = visibleCount < fullList.size
        if (hasMoreItems) {
            rows.add(Row.LoadingMore)
        }

        notifyDataSetChanged()
    }

    override fun getItemViewType(position: Int): Int {
        return when (rows[position]) {
            is Row.Skeleton -> 0
            is Row.Empty -> 1
            is Row.LoadingMore -> 2
            is Row.Header -> 3
            is Row.Tx -> 4
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)

        return when (viewType) {
            0 -> {
                val v = inflater.inflate(R.layout.item_tx_skeleton, parent, false)
                val shimmer = v as? ShimmerFrameLayout
                shimmer?.startShimmer()
                object : RecyclerView.ViewHolder(v) {}
            }
            1 -> {
                val v = inflater.inflate(R.layout.item_tx_empty, parent, false)
                object : RecyclerView.ViewHolder(v) {}
            }
            2 -> {
                val v = inflater.inflate(R.layout.item_tx_loading_more, parent, false)
                val shimmer = v as? ShimmerFrameLayout
                shimmer?.startShimmer()
                object : RecyclerView.ViewHolder(v) {}
            }
            3 -> {
                val v = inflater.inflate(R.layout.item_tx_header, parent, false)
                HeaderVH(v)
            }
            else -> {
                val v = inflater.inflate(R.layout.item_transaction, parent, false)
                TxVH(v, nf, onTransactionClick)
            }
        }
    }
    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val row = rows[position]) {
            is Row.Header -> (holder as HeaderVH).bind(row.title)
            is Row.Tx -> (holder as TxVH).bind(row.tx, displayCurrency)
            is Row.Skeleton,
            is Row.LoadingMore -> {
                val shimmer = holder.itemView as? ShimmerFrameLayout
                shimmer?.startShimmer()
            }
            is Row.Empty -> Unit
        }
    }
    override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
        val shimmer = holder.itemView as? ShimmerFrameLayout
        shimmer?.stopShimmer()
        super.onViewRecycled(holder)
    }

    override fun getItemCount(): Int = rows.size

    // -------------------- VHs --------------------

    private class HeaderVH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvHeader: TextView = itemView.findViewById(R.id.tvHeader)
        fun bind(text: String) {
            tvHeader.text = text
        }
    }

     private class TxVH(
         itemView: View,
         private val nf: NumberFormat,
         private val onTransactionClick: ((TransactionDto) -> Unit)?
     ) :
        RecyclerView.ViewHolder(itemView) {

        // Locked IDs ✅ (DO NOT CHANGE)
        private val tvTitle: TextView = itemView.findViewById(R.id.tvTitle)
        private val tvAmount: TextView = itemView.findViewById(R.id.tvAmount)
        private val tvDesc: TextView = itemView.findViewById(R.id.tvDesc)
        private val tvDate: TextView = itemView.findViewById(R.id.tvDate)

        // New views from the new XML ✅
        private val txIconWrap: MaterialCardView = itemView.findViewById(R.id.txIconWrap)
        private val txIcon: ImageView = itemView.findViewById(R.id.txIcon)

        fun bind(tx: TransactionDto, displayCurrency: String) {
            val ctx = itemView.context

            val typeRaw = (tx.type ?: "").trim().lowercase(Locale.US)
            val isSwap = typeRaw == "swap_in" || typeRaw == "swap_out"
            val isCredit = typeRaw == "credit" || typeRaw.contains("receive") || typeRaw == "swap_in"
            val isDebit = typeRaw == "debit" || typeRaw.contains("send") || typeRaw == "swap_out"

            // Title + desc
            // Title + description: user-friendly activity labels
            val description = tx.description?.trim().orEmpty()

            val friendlyTitle = when {
                typeRaw == "swap_in" -> "Swap Received"
                typeRaw == "swap_out" -> "Swap Sent"
                typeRaw == "credit" && description.contains("admin", ignoreCase = true) -> "Wallet Top-up"
                typeRaw == "credit" -> "Received Money"
                typeRaw == "debit" -> "Sent Money"
                typeRaw.contains("withdraw") -> "Withdrawal"
                typeRaw.contains("deposit") -> "Deposit"
                typeRaw.isNotBlank() -> typeRaw
                    .replace("_", " ")
                    .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
                else -> "Transaction"
            }

            val friendlyDesc = when {
                description.equals("Transfer fee", ignoreCase = true) -> "Transfer fee"
                typeRaw == "swap_in" -> description.ifBlank { "Currency swap received" }
                typeRaw == "swap_out" -> description.ifBlank { "Currency swap sent" }
                typeRaw == "credit" -> description.ifBlank { "Money received" }
                typeRaw == "debit" -> description.ifBlank { "Money sent" }
                else -> description.ifBlank { "—" }
            }

            tvTitle.text = friendlyTitle
            tvDesc.text = friendlyDesc

            // Date
            tvDate.text = formatTxDate(tx.created_at)

            // Amount (show currency to look pro)
            val amount = tx.amount ?: 0.0
            val signed = when {
                isCredit -> "+${nf.format(amount)}"
                isDebit -> "-${nf.format(amount)}"
                else -> nf.format(amount)
            }
            tvAmount.text = "$signed $displayCurrency"

            // Colors + icon (soft + minimal)
            val green = ContextCompat.getColor(ctx, R.color.tx_credit)
            val greenSoft = ContextCompat.getColor(ctx, R.color.tx_credit_soft)
            val redSoft = ContextCompat.getColor(ctx, R.color.tx_debit_soft)
            val red = ContextCompat.getColor(ctx, R.color.tx_debit)
            val blueBg = android.graphics.Color.parseColor("#EEF4FF")
            val greenBg = android.graphics.Color.parseColor("#EAF7EF")
            val redBg = android.graphics.Color.parseColor("#FDECEC")

            val primary = tryColor(ctx, R.color.text_primary, android.R.color.black)

            when {

                isSwap -> {
                    txIconWrap.setCardBackgroundColor(blueBg)
                    txIcon.setImageResource(safeIconRes(R.drawable.ic_swap, R.drawable.ic_more))
                    txIcon.setColorFilter(tryColor(ctx, R.color.paypal_blue, android.R.color.holo_blue_dark))
                    tvAmount.setTextColor(primary)
                }

                isCredit -> {
                    txIconWrap.setCardBackgroundColor(greenBg)
                    txIcon.setImageResource(safeIconRes(R.drawable.ic_plus, R.drawable.ic_send))
                    txIcon.setColorFilter(green)
                    tvAmount.setTextColor(green)
                }
                isDebit -> {
                    txIconWrap.setCardBackgroundColor(redBg)
                    txIcon.setImageResource(safeIconRes(R.drawable.ic_send, R.drawable.ic_send))
                    txIcon.setColorFilter(red)
                    tvAmount.setTextColor(red)
                }
                else -> {
                    txIconWrap.setCardBackgroundColor(blueBg)
                    txIcon.setImageResource(safeIconRes(R.drawable.ic_swap, R.drawable.ic_more))
                    txIcon.setColorFilter(tryColor(ctx, R.color.paypal_blue, android.R.color.holo_blue_dark))
                    tvAmount.setTextColor(primary)
                }
            }

            itemView.setOnClickListener {
                onTransactionClick?.invoke(tx)
            }
        }

        private fun safeIconRes(primaryRes: Int, fallbackRes: Int): Int {
            // If primary doesn't exist, your project won't compile, so only call with existing drawables.
            // Kept for readability; return primary always.
            return primaryRes
        }

        private fun tryColor(ctx: android.content.Context, appColorRes: Int, fallbackAndroid: Int): Int {
            return try {
                ContextCompat.getColor(ctx, appColorRes)
            } catch (_: Exception) {
                ContextCompat.getColor(ctx, fallbackAndroid)
            }
        }

        private fun formatTxDate(raw: String?): String {
            if (raw.isNullOrBlank()) return "—"

            val candidates = listOf(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'",
                "yyyy-MM-dd'T'HH:mm:ss.SSSX",
                "yyyy-MM-dd'T'HH:mm:ssX",
                "yyyy-MM-dd HH:mm:ss"
            )

            val cleaned = raw.trim()
            val outFmt = SimpleDateFormat("MMM d, yyyy • h:mm a", Locale.US)

            for (pattern in candidates) {
                try {
                    val inFmt = SimpleDateFormat(pattern, Locale.US)
                    if (pattern.contains("'Z'")) inFmt.timeZone = TimeZone.getTimeZone("UTC")
                    val d: Date = inFmt.parse(cleaned) ?: continue
                    return outFmt.format(d)
                } catch (_: Exception) {
                }
            }

            return if (cleaned.length >= 10) cleaned.substring(0, 10) else cleaned
        }
    }

    // -------------------- grouping helpers --------------------

    private fun parseDayKey(createdAt: String?): String? {
        if (createdAt.isNullOrBlank()) return null

        val candidates = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd HH:mm:ss"
        )

        for (pattern in candidates) {
            try {
                val inFmt = SimpleDateFormat(pattern, Locale.US)
                if (pattern.contains("'Z'")) inFmt.timeZone = TimeZone.getTimeZone("UTC")
                val d = inFmt.parse(createdAt.trim()) ?: continue
                return dayKey(d)
            } catch (_: Exception) {
            }
        }

        return if (createdAt.length >= 10) createdAt.substring(0, 10) else null
    }

    private fun dayKey(date: Date): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        return fmt.format(date)
    }

    fun showSkeleton(count: Int = 6) {
        rows.clear()
        repeat(count) {
            rows.add(Row.Skeleton)
        }
        notifyDataSetChanged()
    }

    fun showEmpty() {
        rows.clear()
        rows.add(Row.Empty)
        notifyDataSetChanged()
    }
}
