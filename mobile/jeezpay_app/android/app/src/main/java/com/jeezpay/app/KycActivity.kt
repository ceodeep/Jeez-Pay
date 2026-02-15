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
            try {
                val kyc = repo.me().kyc ?: return@launch

                binding.etFullName.setText(kyc.full_name ?: "")
                binding.etDob.setText(kyc.dob ?: "")
                binding.etAddress.setText(kyc.address ?: "")

                // Since your bucket is private, we can't reliably preview existing uploads here
                // without another endpoint to generate signed READ url.
                // We still show a helpful hint via button text.
                if (!kyc.id_path.isNullOrBlank()) binding.btnPickId.text = "ID uploaded (replace)"
                if (!kyc.selfie_path.isNullOrBlank()) binding.btnPickSelfie.text = "Selfie uploaded (replace)"

                // Optional: if pending/approved, you can change submit button text
                val status = kyc.status?.lowercase(Locale.ROOT)
                if (status == "approved") {
                    binding.btnSubmitKyc.text = "KYC Approved"
                    binding.btnSubmitKyc.isEnabled = false
                } else if (status == "pending") {
                    binding.btnSubmitKyc.text = "Update & Resubmit"
                }
            } catch (_: Exception) {
                // ignore; user can still submit
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

        // Require fresh selections for now (keeps flow simple + matches milestone)
        if (localIdUri == null || localSelfieUri == null) {
            toast("Please choose both ID photo and selfie")
            return
        }

        setLoading(true)

        lifecycleScope.launch {
            try {
                // 1) Get signed upload for ID
                val idContentType = contentResolver.getType(localIdUri) ?: "image/jpeg"
                val idUpload = repo.uploadUrl("id", idContentType)
                val idBytes = readAllBytes(localIdUri)

                withContext(Dispatchers.IO) {
                    SignedUploader.putBytes(idUpload.signedUrl, idBytes, idContentType)
                }

                // 2) Get signed upload for Selfie
                val selfieContentType = contentResolver.getType(localSelfieUri) ?: "image/jpeg"
                val selfieUpload = repo.uploadUrl("selfie", selfieContentType)
                val selfieBytes = readAllBytes(localSelfieUri)

                withContext(Dispatchers.IO) {
                    SignedUploader.putBytes(selfieUpload.signedUrl, selfieBytes, selfieContentType)
                }

                // 3) Submit KYC with storage paths
                repo.submit(
                    KycSubmitRequest(
                        fullName = fullName,
                        dob = dob,
                        address = address,
                        idPath = idUpload.path,
                        selfiePath = selfieUpload.path
                    )
                )

                toast("KYC submitted (pending)")
                finish()

            } catch (e: Exception) {
                toast(e.message ?: "KYC submission failed")
            } finally {
                setLoading(false)
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
