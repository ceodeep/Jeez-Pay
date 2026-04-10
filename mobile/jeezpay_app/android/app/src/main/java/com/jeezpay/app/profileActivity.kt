package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.databinding.ActivityProfileBinding
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.KycProfile
import com.jeezpay.app.repository.AuthRepository
import com.jeezpay.app.repository.KycRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.launch
import java.util.Locale

class ProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProfileBinding
    private var approvedKyc: KycProfile? = null
    private val kycRepo = KycRepository()
    private val authRepo = AuthRepository()

    companion object {
        private const val PREFS_NAME = "jeezpay_prefs"
        private const val KEY_SELECTED_AVATAR = "selected_avatar"
    }

    private val avatarOptions = listOf(
        "avatar_1" to R.drawable.avatar_1,
        "avatar_2" to R.drawable.avatar_2,
        "avatar_3" to R.drawable.avatar_3,
        "avatar_4" to R.drawable.avatar_4,
        "avatar_5" to R.drawable.avatar_5,
        "avatar_6" to R.drawable.avatar_6
    )

    private var currentAvatarDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener { finish() }

        binding.avatarClickArea.setOnClickListener {
            showAvatarPickerDialog()
        }

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
                            putExtra("fullName", kyc.fullName ?: "")
                            putExtra("dob", kyc.dob ?: "")
                            putExtra("address", kyc.address ?: "")
                            putExtra("status", kyc.status ?: "")
                            putExtra("avatarResId", getAvatarResIdFromKey(getSelectedAvatarKey()))
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

        binding.rowLogout.setOnClickListener {
            showCustomConfirmDialog(
                message = "Are you sure you want to logout?",
                confirmText = "Logout",
                cancelText = "Stay"
            ) {
                SessionManager(this).clearAll()
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().clear().apply()

                val i = Intent(this, AuthActivity::class.java)
                i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                startActivity(i)
                finish()
            }
        }

        binding.btnStartKyc.setOnClickListener {
            startActivity(Intent(this, KycActivity::class.java))
        }

        applySelectedAvatar()
        populateHeader()
        refreshKycCard()
    }

    override fun onResume() {
        super.onResume()
        applySelectedAvatar()
        populateHeader()
        refreshKycCard()
    }

    private fun getSelectedAvatarKey(): String {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val saved = prefs.getString(KEY_SELECTED_AVATAR, "avatar_1").orEmpty()
        return if (avatarOptions.any { it.first == saved }) saved else "avatar_1"
    }

    private fun getAvatarResIdFromKey(key: String?): Int {
        return avatarOptions.firstOrNull { it.first == key }?.second ?: R.drawable.avatar_1
    }

    private fun saveSelectedAvatarKey(key: String) {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(KEY_SELECTED_AVATAR, key)
            .apply()
    }

    private fun applySelectedAvatar() {
        binding.ivAvatar.setImageResource(getAvatarResIdFromKey(getSelectedAvatarKey()))
    }

    private fun updateAvatarSelection(avatarKey: String) {
        saveSelectedAvatarKey(avatarKey)
        applySelectedAvatar()

        lifecycleScope.launch {
            when (val result = authRepo.updateAvatarSafe(avatarKey)) {
                is ApiResult.Success -> {
                    toast("Avatar updated")
                    currentAvatarDialog?.dismiss()
                }

                is ApiResult.Error -> {
                    handleProfileError(result.error) {
                        updateAvatarSelection(avatarKey)
                    }
                }
            }
        }
    }

    private fun populateHeader() {
        val session = SessionManager(this)
        val phone = session.getPhone().orEmpty()

        binding.tvUserPhone.text = phone.ifBlank { "No phone available" }

        lifecycleScope.launch {
            when (val result = kycRepo.meSafe()) {
                is ApiResult.Success -> {
                    val kyc = result.data.kyc
                    val fullName = kyc?.fullName?.trim().orEmpty()
                    val status = (kyc?.status ?: "").trim().lowercase(Locale.ROOT)

                    val displayName = if (fullName.isNotBlank()) fullName else "JeezPay User"
                    binding.tvUserName.text = displayName

                    when (status) {
                        "approved", "verified" -> {
                            binding.tvKycBadge.visibility = View.VISIBLE
                            binding.tvKycBadge.text = "Verified"
                        }
                        "pending" -> {
                            binding.tvKycBadge.visibility = View.VISIBLE
                            binding.tvKycBadge.text = "Pending"
                        }
                        "rejected" -> {
                            binding.tvKycBadge.visibility = View.VISIBLE
                            binding.tvKycBadge.text = "Rejected"
                        }
                        else -> {
                            binding.tvKycBadge.visibility = View.VISIBLE
                            binding.tvKycBadge.text = "Unverified"
                        }
                    }
                }

                is ApiResult.Error -> {
                    binding.tvUserName.text = "JeezPay User"
                    binding.tvKycBadge.visibility = View.VISIBLE
                    binding.tvKycBadge.text = "Profile"
                }
            }
        }
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

    private fun showAvatarPickerDialog() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 32, 36, 20)
        }

        val title = TextView(this).apply {
            text = "Choose Avatar"
            textSize = 20f
            setTextColor(getColor(R.color.text_primary))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        val subtitle = TextView(this).apply {
            text = "Select one of the predefined avatars"
            textSize = 14f
            setTextColor(getColor(R.color.text_secondary))
            setPadding(0, 10, 0, 24)
        }

        val grid = GridLayout(this).apply {
            columnCount = 3
            rowCount = 2
            useDefaultMargins = true
            alignmentMode = GridLayout.ALIGN_MARGINS
        }

        avatarOptions.forEach { (avatarKey, avatarRes) ->
            val card = CardView(this).apply {
                radius = 999f
                cardElevation = 0f
                setCardBackgroundColor(getColor(R.color.card_white))
                layoutParams = LinearLayout.LayoutParams(220, 220).apply {
                    setMargins(12, 12, 12, 12)
                }
                preventCornerOverlap = true
                useCompatPadding = true
                setContentPadding(18, 18, 18, 18)
            }

            val image = ImageView(this).apply {
                setImageResource(avatarRes)
                scaleType = ImageView.ScaleType.CENTER_CROP
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.MATCH_PARENT
                )
                setOnClickListener {
                    updateAvatarSelection(avatarKey)
                }
            }

            card.addView(image)
            grid.addView(card)
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(grid)

        currentAvatarDialog = AlertDialog.Builder(this)
            .setView(root)
            .create()

        currentAvatarDialog?.window?.setBackgroundDrawableResource(android.R.color.transparent)
        currentAvatarDialog?.show()
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

        btnClose.setOnClickListener { dialog.dismiss() }
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
        ivIcon.setImageResource(R.drawable.ic_warning_red)

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .setCancelable(false)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnCancel.setOnClickListener { dialog.dismiss() }
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
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().clear().apply()

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