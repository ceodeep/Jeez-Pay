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
import android.widget.TextView
import android.widget.ImageView
import androidx.appcompat.app.AlertDialog
import com.jeezpay.app.storage.SessionManager
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.ApiResult

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
                when (val result = kycRepo.meSafe()) {
                    is ApiResult.Success -> {
                        val kyc = result.data.kyc
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
                    }

                    is ApiResult.Error -> {
                        handleProfileError(result.error) {
                            binding.rowProfile.performClick()
                        }
                    }
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
            showCustomConfirmDialog(
                message = "Are you sure you want to logout?",
                confirmText = "Logout",
                cancelText = "Stay"
            ) {
                SessionManager(this).clearAll()
                getSharedPreferences("jeezpay_prefs", MODE_PRIVATE).edit().clear().apply()

                val i = Intent(this, AuthActivity::class.java)
                i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                startActivity(i)
                finish()
            }
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
            when (val result = kycRepo.meSafe()) {
                is ApiResult.Success -> {
                    val kyc = result.data.kyc

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
                            approvedKyc = kyc
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
                            showKycCard(
                                statusChip = "Not verified",
                                title = "Complete your KYC",
                                desc = "Verify your identity to unlock all features.",
                                buttonText = "Start KYC",
                                showButton = true
                            )
                        }
                    }
                }

                is ApiResult.Error -> {
                    approvedKyc = null

                    when (result.error) {
                        is AppError.NoInternet -> {
                            showKycCard(
                                statusChip = "Offline",
                                title = "Unable to load KYC",
                                desc = "No internet connection. Tap to try again.",
                                buttonText = "Retry",
                                showButton = true
                            )

                            binding.btnStartKyc.setOnClickListener {
                                refreshKycCard()
                            }
                        }

                        else -> {
                            showKycCard(
                                statusChip = "KYC",
                                title = "Unable to load KYC",
                                desc = "We couldn't load your KYC status right now.",
                                buttonText = "Retry",
                                showButton = true
                            )

                            binding.btnStartKyc.setOnClickListener {
                                refreshKycCard()
                            }
                        }
                    }
                }
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

    private fun showServerFailureDialog(
        title: String = "Error occured",
        message: String = "We couldn't complete your request right now.",
        retryText: String = "Try again",
        closeText: String = "Close",
        onRetry: () -> Unit = {}
    ) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_error_retry, null)

        val tvTitle = dialogView.findViewById<TextView>(R.id.tvErrorTitle)
        val tvMessage = dialogView.findViewById<TextView>(R.id.tvErrorMessage)
        val btnClose = dialogView.findViewById<TextView>(R.id.btnErrorClose)
        val btnRetry = dialogView.findViewById<TextView>(R.id.btnErrorRetry)

        tvTitle.text = title
        tvMessage.text = message
        btnClose.text = closeText
        btnRetry.text = retryText

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setCancelable(false)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        btnRetry.setOnClickListener {
            dialog.dismiss()
            onRetry()
        }

        dialog.show()
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun showCustomConfirmDialog(
        message: String,
        confirmText: String = "Confirm",
        cancelText: String = "Cancel",
        onConfirm: () -> Unit = {}
    ) {
        val view = layoutInflater.inflate(R.layout.dialog_action_confirm, null)

        val tvMessage = view.findViewById<TextView>(R.id.tvDialogMessage)
        val btnCancel = view.findViewById<TextView>(R.id.btnCancelDialog)
        val btnConfirm = view.findViewById<TextView>(R.id.btnConfirmDialog)
        val ivIcon = view.findViewById<ImageView>(R.id.ivDialogIcon)

        tvMessage.text = message
        btnCancel.text = cancelText
        btnConfirm.text = confirmText

        // keep your red icon for warning/offline state
        ivIcon.setImageResource(R.drawable.ic_warning_red)

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .setCancelable(false)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnConfirm.setOnClickListener {
            dialog.dismiss()
            onConfirm()
        }

        dialog.show()
    }

    private fun handleProfileError(
        error: AppError,
        retryAction: () -> Unit = {}
    ) {
        when (error) {
            is AppError.NoInternet -> {
                showNoInternetDialog(onRetry = retryAction)
            }

            is AppError.Server -> {
                showServerFailureDialog(
                    message = error.message,
                    onRetry = retryAction
                )
            }

            is AppError.Validation -> {
                toast(error.message)
            }

            is AppError.Unauthorized -> {
                toast(error.message)
                SessionManager(this).clearAll()
                getSharedPreferences("jeezpay_prefs", MODE_PRIVATE).edit().clear().apply()

                val i = Intent(this, AuthActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    putExtra(AuthActivity.EXTRA_FORCE_LOGIN, true)
                }
                startActivity(i)
                finish()
            }

            is AppError.Unknown -> {
                showServerFailureDialog(
                    message = error.message,
                    onRetry = retryAction
                )
            }
        }
    }

    private fun showNoInternetDialog(onRetry: () -> Unit = {}) {
        showCustomConfirmDialog(
            message = "No internet connection. Please check your network and try again.",
            confirmText = "Retry",
            cancelText = "Close",
            onConfirm = onRetry
        )
    }
}
