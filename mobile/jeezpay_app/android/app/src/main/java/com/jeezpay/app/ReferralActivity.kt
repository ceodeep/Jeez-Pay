package com.jeezpay.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.repository.AuthRepository
import kotlinx.coroutines.launch

class ReferralActivity : AppCompatActivity() {

    private lateinit var btnBack: ImageView
    private lateinit var tvReferralCode: TextView
    private lateinit var btnCopyCode: LinearLayout
    private lateinit var btnShareCode: LinearLayout

    private lateinit var tvInvitedCount: TextView
    private lateinit var tvSuccessfulCount: TextView
    private lateinit var tvEarnedAmount: TextView
    private lateinit var tvHistoryState: TextView

    private val authRepo = AuthRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_referral)

        bindViews()
        setupHeader()
        setupActions()
        loadReferralData()
    }

    private fun bindViews() {
        btnBack = findViewById(R.id.btnBack)
        tvReferralCode = findViewById(R.id.tvReferralCode)
        btnCopyCode = findViewById(R.id.btnCopyCode)
        btnShareCode = findViewById(R.id.btnShareCode)

        tvInvitedCount = findViewById(R.id.tvInvitedCount)
        tvSuccessfulCount = findViewById(R.id.tvSuccessfulCount)
        tvEarnedAmount = findViewById(R.id.tvEarnedAmount)
        tvHistoryState = findViewById(R.id.tvHistoryState)
    }

    private fun setupHeader() {
        btnBack.setOnClickListener { finish() }
    }

    private fun setupActions() {
        btnCopyCode.setOnClickListener {
            val code = tvReferralCode.text.toString().trim()
            if (code.isNotEmpty() && code != "--") {
                copyReferralCode(code)
            }
        }

        btnShareCode.setOnClickListener {
            val code = tvReferralCode.text.toString().trim()
            if (code.isNotEmpty() && code != "--") {
                shareReferralCode(code)
            }
        }
    }

    private fun loadReferralData() {
        tvReferralCode.text = "--"
        tvInvitedCount.text = "0"
        tvSuccessfulCount.text = "0"
        tvEarnedAmount.text = "0.00 USDT"
        tvHistoryState.text = "Loading..."

        lifecycleScope.launch {

            // 1️⃣ Load user (for referral code)
            val userResult = authRepo.meSafe()

            if (userResult is ApiResult.Success) {
                val user = userResult.data.user
                tvReferralCode.text = user?.referral_code?.ifBlank { "--" } ?: "--"
            } else {
                tvReferralCode.text = "--"
            }

            // 2️⃣ Load referral summary (THIS IS NEW)
            when (val result = authRepo.referralSummarySafe()) {

                is ApiResult.Success -> {
                    val data = result.data

                    tvInvitedCount.text = data.invitedCount.toString()
                    tvSuccessfulCount.text = data.successfulCount.toString()
                    tvEarnedAmount.text = "${data.earnedAmount} ${data.currency}"

                    tvHistoryState.text =
                        if (data.history.isEmpty()) {
                            "No referrals yet"
                        } else {
                            data.history.joinToString("\n\n") { item ->
                                val status = item.status ?: "pending"
                                val name = item.name ?: "JeezPay user"
                                val phone = item.phone ?: ""
                                "$name\n$phone • $status"
                            }
                        }
                }

                is ApiResult.Error -> {
                    tvHistoryState.text = "Failed to load referral stats"
                    Toast.makeText(
                        this@ReferralActivity,
                        "Failed to load referral stats",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    private fun copyReferralCode(code: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("Referral Code", code)
        clipboard.setPrimaryClip(clip)
        Toast.makeText(this, "Referral code copied", Toast.LENGTH_SHORT).show()
    }

    private fun shareReferralCode(code: String) {
        val shareText = "Join JeezPay with my referral code: $code\n\nUse this code when signing up."

        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, shareText)
        }

        startActivity(Intent.createChooser(intent, "Share referral code"))
    }
}