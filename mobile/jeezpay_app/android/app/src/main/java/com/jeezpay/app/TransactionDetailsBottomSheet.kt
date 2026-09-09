package com.jeezpay.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
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
        return inflater.inflate(
            R.layout.bottom_sheet_transaction_details,
            container,
            false
        )
    }

    override fun onViewCreated(
        view: View,
        savedInstanceState: Bundle?
    ) {
        val tvTxAmount = view.findViewById<TextView>(R.id.tvTxAmount)
        val tvTxType = view.findViewById<TextView>(R.id.tvTxType)
        val tvTxSubtitle = view.findViewById<TextView>(R.id.tvTxSubtitle)
        val tvTxDescription = view.findViewById<TextView>(R.id.tvTxDescription)
        val tvTxDate = view.findViewById<TextView>(R.id.tvTxDate)
        val tvTxReference = view.findViewById<TextView>(R.id.tvTxReference)
        val tvTxStatus = view.findViewById<TextView>(R.id.tvTxStatus)
        val tvTxWallet = view.findViewById<TextView>(R.id.tvTxWallet)

        val txIconWrap =
            view.findViewById<MaterialCardView>(R.id.txDetailIconWrap)

        val txIcon =
            view.findViewById<ImageView>(R.id.txDetailIcon)

        val statusPill =
            view.findViewById<MaterialCardView>(R.id.txStatusPill)

        val noteCard =
            view.findViewById<MaterialCardView>(R.id.txNoteCard)

        val btnCopyReference =
            view.findViewById<MaterialButton>(R.id.btnCopyTxReference)

        val btnClose =
            view.findViewById<MaterialButton>(R.id.btnCloseTxSheet)

        val typeRaw =
            (tx.type ?: "").trim().lowercase(Locale.US)

        val description =
            tx.description?.trim().orEmpty()

        val isSwap =
            typeRaw == "swap_in" || typeRaw == "swap_out"

        val isCredit =
            typeRaw == "credit" ||
                typeRaw.contains("receive") ||
                typeRaw == "swap_in"

        val isDebit =
            typeRaw == "debit" ||
                typeRaw.contains("send") ||
                typeRaw == "swap_out"

        val amount = tx.amount ?: 0.0

        val signed = when {
            isCredit -> "+${nf.format(amount)}"
            isDebit -> "-${nf.format(amount)}"
            else -> nf.format(amount)
        }

        val friendlyType = when {
            description.equals(
                "Transfer fee",
                ignoreCase = true
            ) -> "Transfer Fee"

            typeRaw == "swap_in" ->
                "Swap Received"

            typeRaw == "swap_out" ->
                "Swap Sent"

            typeRaw == "credit" &&
                description.contains(
                    "admin",
                    ignoreCase = true
                ) -> "Wallet Top-up"

            typeRaw == "credit" ->
                "Received Money"

            typeRaw == "debit" ->
                "Sent Money"

            typeRaw.contains("withdraw") ->
                "Withdrawal"

            typeRaw.contains("deposit") ->
                "Deposit"

            typeRaw.isNotBlank() ->
                typeRaw
                    .replace("_", " ")
                    .replaceFirstChar {
                        if (it.isLowerCase()) {
                            it.titlecase(Locale.US)
                        } else {
                            it.toString()
                        }
                    }

            else ->
                "Transaction"
        }

        val merchantPayout = Regex(
            """^Merchant payout from\s+(.+?)\s+-\s+(.+)$""",
            RegexOption.IGNORE_CASE
        ).find(description)

        val subtitle: String
        val note: String

        if (merchantPayout != null) {
            subtitle =
                "From ${merchantPayout.groupValues[1].trim()}"

            note =
                merchantPayout.groupValues[2].trim()
        } else {
            subtitle = when {
                isSwap ->
                    "Currency exchange"

                isCredit ->
                    "Money received"

                isDebit ->
                    "Money sent"

                typeRaw.contains("withdraw") ->
                    "Wallet cash-out"

                typeRaw.contains("deposit") ->
                    "Wallet funding"

                else ->
                    "JeezPay activity"
            }

            note = description
        }

        val reference = resolveReference(tx)
        val status = resolveStatus(tx)

        tvTxAmount.text =
            "$signed $displayCurrency"

        tvTxType.text =
            friendlyType

        tvTxSubtitle.text =
            subtitle

        tvTxDescription.text =
            note

        noteCard.visibility =
            if (note.isBlank()) {
                View.GONE
            } else {
                View.VISIBLE
            }

        tvTxDate.text =
            formatTxDate(tx.created_at)

        tvTxReference.text =
            reference

        tvTxStatus.text =
            status

        tvTxWallet.text =
            displayCurrency

        // ------------------------------------------------------
        // Amount + transaction icon
        // ------------------------------------------------------

        val green =
            ContextCompat.getColor(
                requireContext(),
                R.color.tx_credit
            )

        val greenSoft =
            ContextCompat.getColor(
                requireContext(),
                R.color.tx_credit_soft
            )

        val red =
            ContextCompat.getColor(
                requireContext(),
                R.color.tx_debit
            )

        val redSoft =
            ContextCompat.getColor(
                requireContext(),
                R.color.tx_debit_soft
            )

        val blue =
            ContextCompat.getColor(
                requireContext(),
                R.color.paypal_blue
            )

        when {
            isSwap -> {
                txIconWrap.setCardBackgroundColor(
                    android.graphics.Color.parseColor("#EEF4FF")
                )

                txIcon.setImageResource(R.drawable.ic_swap)
                txIcon.setColorFilter(blue)

                tvTxAmount.setTextColor(
                    ContextCompat.getColor(
                        requireContext(),
                        R.color.text_primary
                    )
                )
            }

            isCredit -> {
                txIconWrap.setCardBackgroundColor(greenSoft)
                txIcon.setImageResource(R.drawable.ic_plus)
                txIcon.setColorFilter(green)
                tvTxAmount.setTextColor(green)
            }

            isDebit -> {
                txIconWrap.setCardBackgroundColor(redSoft)
                txIcon.setImageResource(R.drawable.ic_send)
                txIcon.setColorFilter(red)
                tvTxAmount.setTextColor(red)
            }

            else -> {
                txIconWrap.setCardBackgroundColor(
                    android.graphics.Color.parseColor("#EEF4FF")
                )

                txIcon.setImageResource(R.drawable.ic_more)
                txIcon.setColorFilter(blue)
            }
        }

        // ------------------------------------------------------
        // Status chip should represent STATUS, not debit/credit.
        // ------------------------------------------------------

        val normalizedStatus =
            status.trim().lowercase(Locale.US)

        when {
            normalizedStatus.contains("complete") ||
                normalizedStatus.contains("success") ||
                normalizedStatus.contains("paid") -> {

                tvTxStatus.setTextColor(green)
                statusPill.setCardBackgroundColor(greenSoft)
            }

            normalizedStatus.contains("fail") ||
                normalizedStatus.contains("reject") ||
                normalizedStatus.contains("cancel") -> {

                tvTxStatus.setTextColor(red)
                statusPill.setCardBackgroundColor(redSoft)
            }

            else -> {
                tvTxStatus.setTextColor(blue)
                statusPill.setCardBackgroundColor(
                    android.graphics.Color.parseColor("#EEF4FF")
                )
            }
        }

        // ------------------------------------------------------
        // Copy transaction reference
        // ------------------------------------------------------

        btnCopyReference.isEnabled =
            reference.isNotBlank() && reference != "-"

        btnCopyReference.alpha =
            if (btnCopyReference.isEnabled) 1f else 0.5f

        btnCopyReference.setOnClickListener {
            if (!btnCopyReference.isEnabled) {
                return@setOnClickListener
            }

            val clipboard =
                requireContext().getSystemService(
                    Context.CLIPBOARD_SERVICE
                ) as ClipboardManager

            clipboard.setPrimaryClip(
                ClipData.newPlainText(
                    "JeezPay transaction reference",
                    reference
                )
            )

            Toast.makeText(
                requireContext(),
                "Reference copied",
                Toast.LENGTH_SHORT
            ).show()
        }

        btnClose.setOnClickListener {
            dismiss()
        }
    }

    private fun resolveReference(
        tx: TransactionDto
    ): String {
        return try {
            val candidates = listOf(
                "reference",
                "ref",
                "transaction_ref",
                "transactionId",
                "id"
            )

            for (field in candidates) {
                val f =
                    tx.javaClass.declaredFields
                        .firstOrNull {
                            it.name == field
                        }
                        ?: continue

                f.isAccessible = true

                val value =
                    f.get(tx)
                        ?.toString()
                        ?.trim()

                if (!value.isNullOrBlank()) {
                    return value
                }
            }

            "-"
        } catch (_: Exception) {
            "-"
        }
    }

    private fun resolveStatus(
        tx: TransactionDto
    ): String {
        return try {
            val candidates = listOf(
                "status",
                "transaction_status",
                "state"
            )

            for (field in candidates) {
                val f =
                    tx.javaClass.declaredFields
                        .firstOrNull {
                            it.name == field
                        }
                        ?: continue

                f.isAccessible = true

                val value =
                    f.get(tx)
                        ?.toString()
                        ?.trim()

                if (!value.isNullOrBlank()) {
                    return value.replaceFirstChar {
                        it.uppercase()
                    }
                }
            }

            "Completed"
        } catch (_: Exception) {
            "Completed"
        }
    }

    private fun formatTxDate(
        raw: String?
    ): String {
        if (raw.isNullOrBlank()) {
            return "—"
        }

        val candidates = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd HH:mm:ss"
        )

        val cleaned =
            raw.trim()

        val outFmt =
            SimpleDateFormat(
                "MMM d, yyyy • h:mm a",
                Locale.US
            )

        for (pattern in candidates) {
            try {
                val inFmt =
                    SimpleDateFormat(
                        pattern,
                        Locale.US
                    )

                if (pattern.contains("'Z'")) {
                    inFmt.timeZone =
                        TimeZone.getTimeZone("UTC")
                }

                val date: Date =
                    inFmt.parse(cleaned)
                        ?: continue

                return outFmt.format(date)
            } catch (_: Exception) {
            }
        }

        return if (cleaned.length >= 10) {
            cleaned.substring(0, 10)
        } else {
            cleaned
        }
    }
}