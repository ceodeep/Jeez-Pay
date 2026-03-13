package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.databinding.ActivityProfileBinding
import com.jeezpay.app.repository.KycRepository
import kotlinx.coroutines.launch
import java.util.Locale

class ProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProfileBinding
    private var approvedKyc: com.jeezpay.app.network.dto.KycProfile? = null
    private val kycRepo = KycRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Back
        binding.btnBack.setOnClickListener { finish() }

        // Menu rows (placeholders for now)
        binding.rowProfile.setOnClickListener {
            lifecycleScope.launch {
                try {
                    val resp = kycRepo.me()
                    val kyc = resp.kyc
                    val status = (kyc?.status ?: "").trim().lowercase(Locale.ROOT)

                    if (kyc == null || (status != "approved" && status != "verified")) {
                        toast("Complete and approve KYC first")
                        return@launch
                    }

                    approvedKyc = kyc

                    val i = Intent(this@ProfileActivity, ProfileDetailsActivity::class.java).apply {
                        putExtra("full_name", kyc.full_name ?: "")
                        putExtra("dob", kyc.dob ?: "")
                        putExtra("address", kyc.address ?: "")
                        putExtra("status", kyc.status ?: "")
                    }
                    startActivity(i)
                } catch (e: Exception) {
                    toast("Unable to load profile right now")
                }
            }
        }
        binding.rowSecurity.setOnClickListener {
            toast("Security settings (coming soon)")
        }
        binding.rowPayments.setOnClickListener {
            toast("Payment settings (coming soon)")
        }
        binding.rowAbout.setOnClickListener {
            toast("About us (coming soon)")
        }

        // Logout
        binding.rowLogout.setOnClickListener {
            // TODO: clear token/session here (SessionManager.clear())
            val i = Intent(this, AuthActivity::class.java)
            i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(i)
        }

        // Default click: open KYC screen
        binding.btnStartKyc.setOnClickListener {
            startActivity(Intent(this, KycActivity::class.java))
        }

        // First load
        refreshKycCard()
    }

    override fun onResume() {
        super.onResume()
        // If user completed KYC and came back, refresh status
        refreshKycCard()
    }

    private fun refreshKycCard() {
        lifecycleScope.launch {
            try {
                val resp = kycRepo.me()
                val kyc = resp.kyc

                // No record => show Start KYC
                if (kyc == null) {
                    approvedKyc = null
                    showKycCard(
                        statusChip = "Not verified",
                        title = "Complete your KYC",
                        desc = "Verify your identity to unlock all features.",
                        buttonText = "Start KYC",
                        showButton = true
                    )
                    return@launch
                }

                val status = (kyc.status ?: "").trim().lowercase(Locale.ROOT)
                when (status) {
                    "approved", "verified" -> {
                        binding.kycCard.visibility = View.GONE
                    }

                    "pending" -> {
                        approvedKyc = null
                        showKycCard(
                            statusChip = "Pending review",
                            title = "KYC Submitted",
                            desc = "Your documents are under review. We’ll notify you once approved.",
                            buttonText = "View / Update",
                            showButton = true
                        )
                    }

                    "rejected" -> {
                        approvedKyc = null
                        showKycCard(
                            statusChip = "Rejected",
                            title = "KYC Rejected",
                            desc = "Please resubmit with clearer documents.",
                            buttonText = "Resubmit KYC",
                            showButton = true
                        )
                    }

                    else -> {
                        approvedKyc = null
                        // Unknown status => treat as not verified
                        showKycCard(
                            statusChip = "Not verified",
                            title = "Complete your KYC",
                            desc = "Verify your identity to unlock all features.",
                            buttonText = "Start KYC",
                            showButton = true
                        )
                    }
                }

            } catch (e: Exception) {
                // If API fails, don’t block the screen; just keep card hidden or show fallback
                // I’ll show a safe fallback:
                approvedKyc = null
                showKycCard(
                    statusChip = "KYC",
                    title = "Complete your KYC",
                    desc = "Unable to load status. Tap to continue.",
                    buttonText = "Start KYC",
                    showButton = true
                )
            }
        }
    }

    private fun showKycCard(
        statusChip: String,
        title: String,
        desc: String,
        buttonText: String,
        showButton: Boolean
    ) {
        binding.kycCard.visibility = View.VISIBLE
        binding.tvKycStatus.text = statusChip
        binding.tvKycTitle.text = title
        binding.tvKycDesc.text = desc

        binding.btnStartKyc.visibility = if (showButton) View.VISIBLE else View.GONE
        binding.btnStartKyc.text = buttonText
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }
}
