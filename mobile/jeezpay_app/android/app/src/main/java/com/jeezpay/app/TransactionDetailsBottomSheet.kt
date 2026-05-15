package com.jeezpay.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.network.dto.TransactionDto
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class TransactionDetailsBottomSheet(
    private val tx: TransactionDto,
    private val displayCurrency: String
) : BottomSheetDialogFragment() {

    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.bottom_sheet_transaction_details, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val tvTxAmount = view.findViewById<TextView>(R.id.tvTxAmount)
        val tvTxType = view.findViewById<TextView>(R.id.tvTxType)
        val tvTxDescription = view.findViewById<TextView>(R.id.tvTxDescription)
        val tvTxDate = view.findViewById<TextView>(R.id.tvTxDate)
        val tvTxReference = view.findViewById<TextView>(R.id.tvTxReference)
        val tvTxStatus = view.findViewById<TextView>(R.id.tvTxStatus)
        val btnClose = view.findViewById<MaterialButton>(R.id.btnCloseTxSheet)

        val typeRaw = (tx.type ?: "").trim().lowercase(Locale.US)
        val description = tx.description?.trim().orEmpty()

        val isSwap = typeRaw == "swap_in" || typeRaw == "swap_out"
        val isCredit = typeRaw == "credit" || typeRaw.contains("receive") || typeRaw == "swap_in"
        val isDebit = typeRaw == "debit" || typeRaw.contains("send") || typeRaw == "swap_out"

        val amount = tx.amount ?: 0.0
        val signed = when {
            isCredit -> "+${nf.format(amount)}"
            isDebit -> "-${nf.format(amount)}"
            else -> nf.format(amount)
        }

        val friendlyType = when {
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

        val friendlyDescription = when {
            description.equals("Transfer fee", ignoreCase = true) -> "Transfer fee"
            typeRaw == "swap_in" -> description.ifBlank { "Currency swap received" }
            typeRaw == "swap_out" -> description.ifBlank { "Currency swap sent" }
            typeRaw == "credit" -> description.ifBlank { "Money received" }
            typeRaw == "debit" -> description.ifBlank { "Money sent" }
            else -> description.ifBlank { "—" }
        }

        tvTxAmount.text = "$signed $displayCurrency"
        tvTxType.text = friendlyType
        tvTxDescription.text = friendlyDescription
        tvTxDate.text = formatTxDate(tx.created_at)
        tvTxReference.text = resolveReference(tx)
        tvTxStatus.text = resolveStatus(tx)

        val statusColor = when {
            isSwap -> ContextCompat.getColor(requireContext(), R.color.paypal_blue)
            isCredit -> ContextCompat.getColor(requireContext(), R.color.tx_credit)
            isDebit -> ContextCompat.getColor(requireContext(), R.color.tx_debit)
            else -> ContextCompat.getColor(requireContext(), R.color.text_primary)
        }

        tvTxStatus.setTextColor(statusColor)

        btnClose.setOnClickListener { dismiss() }
    }

    private fun resolveReference(tx: TransactionDto): String {
        return try {
            val candidates = listOf("reference", "ref", "transaction_ref", "transactionId", "id")
            for (field in candidates) {
                val f = tx.javaClass.declaredFields.firstOrNull { it.name == field } ?: continue
                f.isAccessible = true
                val value = f.get(tx)?.toString()?.trim()
                if (!value.isNullOrBlank()) return value
            }
            "-"
        } catch (_: Exception) {
            "-"
        }
    }

    private fun resolveStatus(tx: TransactionDto): String {
        return try {
            val candidates = listOf("status", "transaction_status", "state")
            for (field in candidates) {
                val f = tx.javaClass.declaredFields.firstOrNull { it.name == field } ?: continue
                f.isAccessible = true
                val value = f.get(tx)?.toString()?.trim()
                if (!value.isNullOrBlank()) {
                    return value.replaceFirstChar { it.uppercase() }
                }
            }
            "Completed"
        } catch (_: Exception) {
            "Completed"
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