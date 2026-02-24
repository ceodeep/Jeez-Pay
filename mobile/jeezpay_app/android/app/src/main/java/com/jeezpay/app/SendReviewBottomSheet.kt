package com.jeezpay.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import java.text.DecimalFormat

class SendReviewBottomSheet(
    private val receiverIdentifier: String,
    private val recipientDisplay: String,
    private val currency: String,
    private val amount: Double,
    private val fee: Double,
    private val onConfirm: () -> Unit
) : BottomSheetDialogFragment() {

    private val df = DecimalFormat("#,##0.##")

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.bottom_sheet_send_review, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val btnClose = view.findViewById<ImageView>(R.id.btnClose)
        val tvReviewAmount = view.findViewById<TextView>(R.id.tvReviewAmount)
        val tvReviewCurrency = view.findViewById<TextView>(R.id.tvReviewCurrency)
        val tvReviewRecipient = view.findViewById<TextView>(R.id.tvReviewRecipient)
        val tvReviewUid = view.findViewById<TextView>(R.id.tvReviewUid)
        val tvReviewFee = view.findViewById<TextView>(R.id.tvReviewFee)
        val btnConfirm = view.findViewById<MaterialButton>(R.id.btnConfirm)

        tvReviewAmount.text = df.format(amount)
        tvReviewCurrency.text = currency
        tvReviewRecipient.text = recipientDisplay
        tvReviewUid.text = receiverIdentifier
        tvReviewFee.text = "${df.format(fee)} $currency"

        btnClose.setOnClickListener { dismiss() }
        btnConfirm.setOnClickListener {
            dismiss()
            onConfirm()
        }
    }
}