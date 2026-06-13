package com.jeezpay.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.network.dto.WithdrawalDto

class WithdrawalDetailsBottomSheet(
    private val withdrawal: WithdrawalDto
) : BottomSheetDialogFragment() {

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(
            R.layout.bottom_sheet_withdrawal_details,
            container,
            false
        )
    }

    override fun onViewCreated(
        view: View,
        savedInstanceState: Bundle?
    ) {

        view.findViewById<TextView>(R.id.tvAmount).text =
            "Amount: ${withdrawal.amount ?: 0.0} USDT"

        view.findViewById<TextView>(R.id.tvNetwork).text =
            "Network: ${withdrawal.network ?: "-"}"

        view.findViewById<TextView>(R.id.tvAddress).text =
            "Address: ${withdrawal.to_address ?: "-"}"

        view.findViewById<TextView>(R.id.tvReference).text =
            "Reference: ${withdrawal.reference ?: "-"}"

        view.findViewById<TextView>(R.id.tvStatus).text =
            "Status: ${withdrawal.status ?: "-"}"

        view.findViewById<TextView>(R.id.tvHash).text =
            "Tx Hash: ${withdrawal.tx_hash ?: "Pending"}"

        view.findViewById<TextView>(R.id.tvDate).text =
            "Date: ${withdrawal.created_at ?: "-"}"

        view.findViewById<MaterialButton>(R.id.btnViewExplorer)
            .setOnClickListener {

                val hash = withdrawal.tx_hash ?: return@setOnClickListener

                val url =
                    "https://tronscan.org/#/transaction/$hash"

                startActivity(
                    Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse(url)
                    )
                )
            }
    }
}