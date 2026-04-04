package com.jeezpay.app

import android.app.DatePickerDialog
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.databinding.ActivityKycBinding
import com.jeezpay.app.network.SignedUploader
import com.jeezpay.app.network.dto.KycSubmitRequest
import com.jeezpay.app.repository.KycRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.Locale
import android.content.Intent
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.storage.SessionManager

class KycActivity : AppCompatActivity() {

    private lateinit var binding: ActivityKycBinding
    private val repo = KycRepository()

    private var idUri: Uri? = null
    private var selfieUri: Uri? = null

    private val pickId = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            idUri = uri
            binding.imgIdPreview.setImageURI(uri)
            binding.btnPickId.text = "ID selected"
        }
    }

    private val pickSelfie = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            selfieUri = uri
            binding.imgSelfiePreview.setImageURI(uri)
            binding.btnPickSelfie.text = "Selfie selected"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityKycBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Toolbar back
        binding.toolbarKyc.setNavigationOnClickListener { finish() }

        // DOB picker
        binding.etDob.setOnClickListener { openDobPicker() }
        // also allow clicking the end icon area
        binding.etDob.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) openDobPicker()
        }

        // Pickers
        binding.btnPickId.setOnClickListener { pickId.launch("image/*") }
        binding.btnPickSelfie.setOnClickListener { pickSelfie.launch("image/*") }

        // Submit
        binding.btnSubmitKyc.setOnClickListener { submitKyc() }

        // Prefill from API if exists
        prefillFromServer()
    }

    private fun prefillFromServer() {
        lifecycleScope.launch {
            when (val result = repo.meSafe()) {
                is ApiResult.Success -> {
                    val kyc = result.data.kyc ?: return@launch

                    binding.etFullName.setText(kyc.fullName ?: "")
                    binding.etDob.setText(kyc.dob ?: "")
                    binding.etAddress.setText(kyc.address ?: "")

                    if (!kyc.id_path.isNullOrBlank()) binding.btnPickId.text = "ID uploaded (replace)"
                    if (!kyc.selfie_path.isNullOrBlank()) binding.btnPickSelfie.text = "Selfie uploaded (replace)"

                    val status = kyc.status?.lowercase(Locale.ROOT)
                    if (status == "approved") {
                        binding.btnSubmitKyc.text = "KYC Approved"
                        binding.btnSubmitKyc.isEnabled = false
                    } else if (status == "pending") {
                        binding.btnSubmitKyc.text = "Update & Resubmit"
                    }
                }

                is ApiResult.Error -> {
                    handleKycError(result.error) {
                        prefillFromServer()
                    }
                }
            }
        }
    }

    private fun openDobPicker() {
        val cal = Calendar.getInstance()
        val dlg = DatePickerDialog(
            this,
            { _, year, month, dayOfMonth ->
                // month is 0-based
                val mm = (month + 1).toString().padStart(2, '0')
                val dd = dayOfMonth.toString().padStart(2, '0')
                binding.etDob.setText("$year-$mm-$dd")
            },
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH),
            cal.get(Calendar.DAY_OF_MONTH)
        )
        dlg.show()
    }

    private fun submitKyc() {
        val fullName = binding.etFullName.text?.toString()?.trim().orEmpty()
        val dob = binding.etDob.text?.toString()?.trim().orEmpty()
        val address = binding.etAddress.text?.toString()?.trim().orEmpty()

        val localIdUri = idUri
        val localSelfieUri = selfieUri

        if (fullName.isBlank() || dob.isBlank() || address.isBlank()) {
            toast("Please fill full name, DOB, and address")
            return
        }

        if (localIdUri == null || localSelfieUri == null) {
            toast("Please choose both ID photo and selfie")
            return
        }

        setLoading(true)

        lifecycleScope.launch {
            try {
                val idContentType = contentResolver.getType(localIdUri) ?: "image/jpeg"

                val idUploadResult = repo.uploadUrlSafe("id", idContentType)
                if (idUploadResult is ApiResult.Error) {
                    setLoading(false)
                    handleKycError(idUploadResult.error) {
                        submitKyc()
                    }
                    return@launch
                }
                val idUpload = (idUploadResult as ApiResult.Success).data
                val idBytes = readAllBytes(localIdUri)

                withContext(Dispatchers.IO) {
                    SignedUploader.putBytes(idUpload.signedUrl, idBytes, idContentType)
                }

                val selfieContentType = contentResolver.getType(localSelfieUri) ?: "image/jpeg"

                val selfieUploadResult = repo.uploadUrlSafe("selfie", selfieContentType)
                if (selfieUploadResult is ApiResult.Error) {
                    setLoading(false)
                    handleKycError(selfieUploadResult.error) {
                        submitKyc()
                    }
                    return@launch
                }
                val selfieUpload = (selfieUploadResult as ApiResult.Success).data
                val selfieBytes = readAllBytes(localSelfieUri)

                withContext(Dispatchers.IO) {
                    SignedUploader.putBytes(selfieUpload.signedUrl, selfieBytes, selfieContentType)
                }

                when (
                    val submitResult = repo.submitSafe(
                        KycSubmitRequest(
                            fullName = fullName,
                            dob = dob,
                            address = address,
                            idPath = idUpload.path,
                            selfiePath = selfieUpload.path
                        )
                    )
                ) {
                    is ApiResult.Success -> {
                        toast("KYC submitted (pending)")
                        finish()
                    }

                    is ApiResult.Error -> {
                        handleKycError(submitResult.error) {
                            submitKyc()
                        }
                    }
                }

            } catch (e: Exception) {
                showServerFailureDialog(
                    message = e.message ?: "KYC submission failed",
                    onRetry = { submitKyc() }
                )
            } finally {
                setLoading(false)
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

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnConfirm.setOnClickListener {
            dialog.dismiss()
            onConfirm()
        }

        dialog.show()
    }

    private fun handleKycError(
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

    private fun readAllBytes(uri: Uri): ByteArray {
        contentResolver.openInputStream(uri).use { input ->
            if (input == null) throw IllegalStateException("Can't open selected file")
            return input.readBytes()
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.btnSubmitKyc.isEnabled = !loading
        binding.btnPickId.isEnabled = !loading
        binding.btnPickSelfie.isEnabled = !loading

        binding.btnSubmitKyc.text = if (loading) "Submitting..." else "Submit KYC"
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }
}
