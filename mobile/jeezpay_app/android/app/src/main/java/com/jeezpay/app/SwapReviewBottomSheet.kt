package com.jeezpay.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import java.text.DecimalFormat

class SwapReviewBottomSheet(
    private val fromCurrency: String,
    private val toCurrency: String,
    private val amount: Double,
    private val rate: Double,
    private val fee: Double,
    private val totalDebit: Double,
    private val receiveAmount: Double,
    private val onConfirm: () -> Unit
) : BottomSheetDialogFragment() {

    private val df = DecimalFormat("#,##0.##")
    private var locked = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.bottom_sheet_swap_review, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val tvSwapFrom = view.findViewById<TextView>(R.id.tvSwapFrom)
        val tvSwapTo = view.findViewById<TextView>(R.id.tvSwapTo)
        val tvSwapRate = view.findViewById<TextView>(R.id.tvSwapRate)
        val tvSwapFee = view.findViewById<TextView>(R.id.tvSwapFee)
        val tvSwapTotal = view.findViewById<TextView>(R.id.tvSwapTotal)
        val btnConfirmSwap = view.findViewById<MaterialButton>(R.id.btnConfirmSwap)

        tvSwapFrom.text = "From: ${df.format(amount)} $fromCurrency"
        tvSwapTo.text = "To: ${df.format(receiveAmount)} $toCurrency"
        tvSwapRate.text = "Rate: 1 $fromCurrency = ${df.format(rate)} $toCurrency"
        tvSwapFee.text = "Fee: ${df.format(fee)} $fromCurrency"
        tvSwapTotal.text = "Total deducted: ${df.format(totalDebit)} $fromCurrency"

        btnConfirmSwap.setOnClickListener {
            if (locked) return@setOnClickListener
            locked = true
            btnConfirmSwap.isEnabled = false
            btnConfirmSwap.alpha = 0.7f

            onConfirm()
            dismissAllowingStateLoss()
        }
    }
}