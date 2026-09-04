package com.jeezpay.app

import android.Manifest
import android.app.DatePickerDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.databinding.ActivityKycBinding
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.SignedUploader
import com.jeezpay.app.network.dto.KycConsentsRequest
import com.jeezpay.app.network.dto.KycDocumentRequest
import com.jeezpay.app.network.dto.KycPolicyResponse
import com.jeezpay.app.network.dto.KycProfile
import com.jeezpay.app.network.dto.KycSubmitRequest
import com.jeezpay.app.repository.KycRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Calendar
import java.util.Locale

class KycActivity : AppCompatActivity() {

    private lateinit var binding: ActivityKycBinding
    private val repo = KycRepository()

    private var policy: KycPolicyResponse? = null
    private var currentStep = 1
    private var formLocked = false

    private var idFrontUri: Uri? = null
    private var idBackUri: Uri? = null
    private var selfieUri: Uri? = null
    private var pendingCameraUri: Uri? = null
    private var pendingCapture: CaptureKind? = null

    private val countryLabelToCode = linkedMapOf<String, String>()
    private val documentTypeMap = linkedMapOf(
        "Passport" to "passport",
        "National ID" to "national_id",
        "Driver's licence" to "driver_license",
        "Residence permit" to "residence_permit",
        "Refugee ID" to "refugee_id",
        "Other government ID" to "other_government_id"
    )
    private val employmentMap = linkedMapOf(
        "Employed" to "employed",
        "Self-employed / business owner" to "self_employed",
        "Student" to "student",
        "Unemployed" to "unemployed",
        "Retired" to "retired",
        "Homemaker" to "homemaker",
        "Other" to "other"
    )
    private val purposeMap = linkedMapOf(
        "Personal payments" to "personal_payments",
        "Family support / remittances" to "family_support",
        "Salary / income receiving" to "income_receiving",
        "Business payments" to "business_payments",
        "Savings" to "savings",
        "Other" to "other"
    )
    private val volumeMap = linkedMapOf(
        "Low" to "low",
        "Standard" to "standard",
        "High" to "high",
        "Very high" to "very_high"
    )
    private val txCountMap = linkedMapOf(
        "1–20 transactions" to "1_20",
        "21–100 transactions" to "21_100",
        "101–500 transactions" to "101_500",
        "500+ transactions" to "500_plus"
    )

    private enum class CaptureKind { ID_FRONT, ID_BACK, SELFIE }

    private val takePicture = registerForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val uri = pendingCameraUri
        val kind = pendingCapture
        pendingCameraUri = null
        pendingCapture = null
        if (!success || uri == null || kind == null) return@registerForActivityResult

        when (kind) {
            CaptureKind.ID_FRONT -> {
                idFrontUri = uri
                binding.imgIdPreview.setImageURI(uri)
                binding.imgIdPreview.visibility = View.VISIBLE
                binding.btnPickId.text = "Retake"
            }
            CaptureKind.ID_BACK -> {
                idBackUri = uri
                binding.imgIdBackPreview.setImageURI(uri)
                binding.imgIdBackPreview.visibility = View.VISIBLE
                binding.btnPickIdBack.text = "Retake"
            }
            CaptureKind.SELFIE -> {
                selfieUri = uri
                binding.imgSelfiePreview.setImageURI(uri)
                binding.imgSelfiePreview.visibility = View.VISIBLE
                binding.btnPickSelfie.text = "Retake"
            }
        }
    }

    private val requestCameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            pendingCapture?.let { launchCamera(it) }
        } else {
            pendingCapture = null
            toast("Camera permission is required for identity verification")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityKycBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbarKyc.setNavigationOnClickListener { finish() }
        configureDropdowns()
        configureDates()
        configureCameraButtons()
        configureNavigation()
        configureConsentLinks()

        binding.btnSubmitKyc.setOnClickListener { submitKyc() }
        renderStep()
        loadPolicyAndProfile()
    }

    private fun configureDropdowns() {
        Locale.getISOCountries()
            .map { code -> code to Locale("", code).getDisplayCountry(Locale.getDefault()) }
            .filter { it.second.isNotBlank() }
            .sortedBy { it.second.lowercase(Locale.getDefault()) }
            .forEach { (code, name) -> countryLabelToCode["$name ($code)"] = code }

        val countryLabels = countryLabelToCode.keys.toList()
        val countryAdapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, countryLabels)
        binding.acNationality.setAdapter(countryAdapter)
        binding.acCountryOfBirth.setAdapter(countryAdapter)
        binding.acResidenceCountry.setAdapter(countryAdapter)
        binding.acIssuingCountry.setAdapter(countryAdapter)

        binding.acDocumentType.setAdapter(
            ArrayAdapter(this, android.R.layout.simple_list_item_1, documentTypeMap.keys.toList())
        )
        binding.acEmploymentStatus.setAdapter(
            ArrayAdapter(this, android.R.layout.simple_list_item_1, employmentMap.keys.toList())
        )
        binding.acAccountPurpose.setAdapter(
            ArrayAdapter(this, android.R.layout.simple_list_item_1, purposeMap.keys.toList())
        )
        binding.acExpectedVolume.setAdapter(
            ArrayAdapter(this, android.R.layout.simple_list_item_1, volumeMap.keys.toList())
        )
        binding.acExpectedTxCount.setAdapter(
            ArrayAdapter(this, android.R.layout.simple_list_item_1, txCountMap.keys.toList())
        )

        binding.acDocumentType.setOnItemClickListener { _, _, _, _ -> updateBackRequirement() }
    }

    private fun configureDates() {
        binding.etDob.setOnClickListener { openDatePicker(DateTarget.DOB) }
        binding.etDocumentIssueDate.setOnClickListener { openDatePicker(DateTarget.ISSUE_DATE) }
        binding.etDocumentExpiryDate.setOnClickListener { openDatePicker(DateTarget.EXPIRY_DATE) }
        binding.cbDocumentNoExpiry.setOnCheckedChangeListener { _, checked ->
            binding.etDocumentExpiryDate.isEnabled = !checked
            if (checked) binding.etDocumentExpiryDate.setText("")
        }
    }

    private enum class DateTarget { DOB, ISSUE_DATE, EXPIRY_DATE }

    private fun openDatePicker(target: DateTarget) {
        val cal = Calendar.getInstance()
        val dialog = DatePickerDialog(
            this,
            { _, year, month, day ->
                val value = "%04d-%02d-%02d".format(year, month + 1, day)
                when (target) {
                    DateTarget.DOB -> binding.etDob.setText(value)
                    DateTarget.ISSUE_DATE -> binding.etDocumentIssueDate.setText(value)
                    DateTarget.EXPIRY_DATE -> binding.etDocumentExpiryDate.setText(value)
                }
            },
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH),
            cal.get(Calendar.DAY_OF_MONTH)
        )
        when (target) {
            DateTarget.DOB, DateTarget.ISSUE_DATE -> dialog.datePicker.maxDate = System.currentTimeMillis()
            DateTarget.EXPIRY_DATE -> dialog.datePicker.minDate = System.currentTimeMillis() - 86_400_000L
        }
        dialog.show()
    }

    private fun configureCameraButtons() {
        binding.btnPickId.setOnClickListener { startCamera(CaptureKind.ID_FRONT) }
        binding.btnPickIdBack.setOnClickListener { startCamera(CaptureKind.ID_BACK) }
        binding.btnPickSelfie.setOnClickListener { startCamera(CaptureKind.SELFIE) }
    }

    private fun startCamera(kind: CaptureKind) {
        if (formLocked) return
        pendingCapture = kind
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (granted) launchCamera(kind) else requestCameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun launchCamera(kind: CaptureKind) {
        pendingCapture = kind
        val prefix = when (kind) {
            CaptureKind.ID_FRONT -> "kyc_id_front_"
            CaptureKind.ID_BACK -> "kyc_id_back_"
            CaptureKind.SELFIE -> "kyc_selfie_"
        }
        val file = File.createTempFile(prefix, ".jpg", cacheDir)
        val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", file)
        pendingCameraUri = uri
        takePicture.launch(uri)
    }

    private fun configureNavigation() {
        binding.btnKycNextStep.setOnClickListener {
            if (validateStep(currentStep)) {
                currentStep = (currentStep + 1).coerceAtMost(4)
                renderStep()
            }
        }
        binding.btnKycBackStep.setOnClickListener {
            currentStep = (currentStep - 1).coerceAtLeast(1)
            renderStep()
        }
    }

    private fun configureConsentLinks() {
        binding.cbPrivacyConsent.setOnLongClickListener {
            startActivity(Intent(this, PrivacyActivity::class.java))
            true
        }
        binding.tvKycStatusMessage.setOnLongClickListener {
            startActivity(Intent(this, PrivacyActivity::class.java))
            true
        }
    }

    private fun renderStep() {
        if (formLocked) return
        binding.sectionPersonal.visibility = if (currentStep == 1) View.VISIBLE else View.GONE
        binding.sectionDocument.visibility = if (currentStep == 2) View.VISIBLE else View.GONE
        binding.sectionRisk.visibility = if (currentStep == 3) View.VISIBLE else View.GONE
        binding.sectionVerification.visibility = if (currentStep == 4) View.VISIBLE else View.GONE

        val names = listOf("Personal details", "Government document", "Financial profile", "Verification & consent")
        binding.tvKycStep.text = "Step $currentStep of 4"
        binding.tvKycStepName.text = names[currentStep - 1]
        binding.btnKycBackStep.visibility = if (currentStep > 1) View.VISIBLE else View.GONE
        binding.btnKycNextStep.visibility = if (currentStep < 4) View.VISIBLE else View.GONE
        binding.btnSubmitKyc.visibility = if (currentStep == 4) View.VISIBLE else View.GONE
        binding.scrollKyc.smoothScrollTo(0, 0)
    }

    private fun loadPolicyAndProfile() {
        lifecycleScope.launch {
            setPageLoading(true)
            when (val policyResult = repo.policySafe()) {
                is ApiResult.Success -> policy = policyResult.data
                is ApiResult.Error -> {
                    setPageLoading(false)
                    handleKycError(policyResult.error) { loadPolicyAndProfile() }
                    return@launch
                }
            }

            when (val result = repo.meSafe()) {
                is ApiResult.Success -> applyProfile(result.data.kyc)
                is ApiResult.Error -> handleKycError(result.error) { loadPolicyAndProfile() }
            }
            setPageLoading(false)
        }
    }

    private fun applyProfile(kyc: KycProfile?) {
        if (kyc == null) return
        binding.etFullName.setText(kyc.fullName.orEmpty())
        binding.etDob.setText(kyc.dob.orEmpty())
        binding.etAddress.setText(kyc.addressLine1 ?: kyc.address.orEmpty())
        binding.etAddressLine2.setText(kyc.addressLine2.orEmpty())
        binding.etCity.setText(kyc.city.orEmpty())
        binding.etRegion.setText(kyc.region.orEmpty())
        binding.etPostalCode.setText(kyc.postalCode.orEmpty())
        binding.etOccupation.setText(kyc.occupation.orEmpty())
        binding.etEmployerName.setText(kyc.employerName.orEmpty())

        setCountry(binding.acNationality, kyc.nationality)
        setCountry(binding.acCountryOfBirth, kyc.countryOfBirth)
        setCountry(binding.acResidenceCountry, kyc.residenceCountry)
        setMappedValue(binding.acEmploymentStatus, employmentMap, kyc.employmentStatus)
        setMappedValue(binding.acAccountPurpose, purposeMap, kyc.accountPurpose)
        setMappedValue(binding.acExpectedVolume, volumeMap, kyc.expectedMonthlyVolumeBand)
        setMappedValue(binding.acExpectedTxCount, txCountMap, kyc.expectedMonthlyTxCountBand)
        binding.cbPepSelf.isChecked = kyc.pepSelfDeclared
        binding.cbPepRelated.isChecked = kyc.pepRelatedDeclared
        restoreSources(kyc.sourceOfFunds)

        val workflow = kyc.workflowStatus?.lowercase(Locale.ROOT) ?: kyc.status?.lowercase(Locale.ROOT)
        when {
            kyc.status.equals("approved", true) -> lockForm(
                "Identity verified",
                if (kyc.nextReviewAt.isNullOrBlank()) "Your identity verification is approved." else "Approved. Your next periodic review is scheduled for ${kyc.nextReviewAt}."
            )
            workflow == "submitted" || workflow == "in_review" || kyc.status.equals("pending", true) && workflow != "needs_more_info" -> lockForm(
                "Verification in review",
                "Your information has been submitted. We will notify you when review is complete."
            )
            workflow == "needs_more_info" -> {
                binding.tvKycStatusTitle.text = "More information needed"
                binding.tvKycStatusMessage.text = kyc.rejectionReason ?: "Please update your information and submit again."
            }
            kyc.status.equals("rejected", true) -> {
                binding.tvKycStatusTitle.text = "Verification needs attention"
                binding.tvKycStatusMessage.text = kyc.rejectionReason ?: "Your previous submission was not approved. Please correct the information and resubmit."
            }
        }
    }

    private fun lockForm(title: String, message: String) {
        formLocked = true
        binding.tvKycStatusTitle.text = title
        binding.tvKycStatusMessage.text = message
        binding.layoutKycProgress.visibility = View.GONE
        binding.sectionPersonal.visibility = View.GONE
        binding.sectionDocument.visibility = View.GONE
        binding.sectionRisk.visibility = View.GONE
        binding.sectionVerification.visibility = View.GONE
        binding.layoutStepNavigation.visibility = View.GONE
        binding.btnSubmitKyc.visibility = View.GONE
    }

    private fun setCountry(view: com.google.android.material.textfield.MaterialAutoCompleteTextView, code: String?) {
        if (code.isNullOrBlank()) return
        countryLabelToCode.entries.firstOrNull { it.value.equals(code, true) }?.key?.let { view.setText(it, false) }
    }

    private fun setMappedValue(
        view: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        map: Map<String, String>,
        value: String?
    ) {
        if (value.isNullOrBlank()) return
        map.entries.firstOrNull { it.value.equals(value, true) }?.key?.let { view.setText(it, false) }
    }

    private fun restoreSources(values: List<String>) {
        binding.chipSalary.isChecked = values.contains("salary")
        binding.chipBusiness.isChecked = values.contains("business")
        binding.chipSavings.isChecked = values.contains("savings")
        binding.chipInvestments.isChecked = values.contains("investments")
        binding.chipFamily.isChecked = values.contains("family_support")
        binding.chipOtherFunds.isChecked = values.contains("other")
    }

    private fun validateStep(step: Int): Boolean {
        return when (step) {
            1 -> {
                if (text(binding.etFullName).isBlank() || text(binding.etDob).isBlank() ||
                    countryCode(binding.acNationality) == null || countryCode(binding.acCountryOfBirth) == null ||
                    countryCode(binding.acResidenceCountry) == null || text(binding.etAddress).isBlank() || text(binding.etCity).isBlank()
                ) {
                    toast("Complete all required personal identity fields")
                    false
                } else true
            }
            2 -> {
                val documentType = documentTypeMap[binding.acDocumentType.text.toString()]
                val backRequired = documentType != null && documentType != "passport"
                val noExpiry = binding.cbDocumentNoExpiry.isChecked
                if (documentType == null || countryCode(binding.acIssuingCountry) == null || text(binding.etDocumentNumber).isBlank()) {
                    toast("Complete the government document details")
                    false
                } else if (!noExpiry && text(binding.etDocumentExpiryDate).isBlank()) {
                    toast("Enter the document expiry date or select no expiry")
                    false
                } else if (idFrontUri == null) {
                    toast("Capture the front of your identity document")
                    false
                } else if (backRequired && idBackUri == null) {
                    toast("Capture the back of this identity document")
                    false
                } else true
            }
            3 -> {
                if (employmentMap[binding.acEmploymentStatus.text.toString()] == null || text(binding.etOccupation).isBlank() ||
                    selectedSources().isEmpty() || purposeMap[binding.acAccountPurpose.text.toString()] == null ||
                    volumeMap[binding.acExpectedVolume.text.toString()] == null || txCountMap[binding.acExpectedTxCount.text.toString()] == null
                ) {
                    toast("Complete your financial profile")
                    false
                } else if (!validTaxResidencies()) {
                    toast("Tax residence countries must use two-letter ISO codes")
                    false
                } else true
            }
            4 -> {
                if (selfieUri == null) {
                    toast("Capture a selfie for identity comparison")
                    false
                } else if (!binding.cbPrivacyConsent.isChecked || !binding.cbIdentityConsent.isChecked ||
                    !binding.cbBiometricConsent.isChecked || !binding.cbScreeningConsent.isChecked
                ) {
                    toast("Accept all required verification and privacy notices")
                    false
                } else true
            }
            else -> true
        }
    }

    private fun updateBackRequirement() {
        val type = documentTypeMap[binding.acDocumentType.text.toString()]
        val required = type != null && type != "passport"
        binding.tvIdBackHint.text = if (required) "Required for this document type." else "Optional for this document type."
    }

    private fun submitKyc() {
        if (formLocked || policy == null) {
            if (policy == null) toast("KYC policy is still loading")
            return
        }
        if (!(1..4).all { validateStep(it) }) return

        val currentPolicy = policy ?: return
        val front = idFrontUri ?: return
        val selfie = selfieUri ?: return
        setLoading(true)

        lifecycleScope.launch {
            try {
                val frontPath = uploadEvidence("id_front", front, currentPolicy.maxUploadBytes)
                val backPath = idBackUri?.let { uploadEvidence("id_back", it, currentPolicy.maxUploadBytes) }
                val selfiePath = uploadEvidence("selfie", selfie, currentPolicy.maxUploadBytes)

                val documentType = documentTypeMap[binding.acDocumentType.text.toString()] ?: error("Document type missing")
                val request = KycSubmitRequest(
                    fullName = text(binding.etFullName),
                    dob = text(binding.etDob),
                    nationality = countryCode(binding.acNationality) ?: error("Nationality missing"),
                    countryOfBirth = countryCode(binding.acCountryOfBirth) ?: error("Country of birth missing"),
                    residenceCountry = countryCode(binding.acResidenceCountry) ?: error("Residence country missing"),
                    addressLine1 = text(binding.etAddress),
                    addressLine2 = text(binding.etAddressLine2).ifBlank { null },
                    city = text(binding.etCity),
                    region = text(binding.etRegion).ifBlank { null },
                    postalCode = text(binding.etPostalCode).ifBlank { null },
                    employmentStatus = employmentMap[binding.acEmploymentStatus.text.toString()] ?: error("Employment missing"),
                    occupation = text(binding.etOccupation),
                    employerName = text(binding.etEmployerName).ifBlank { null },
                    sourceOfFunds = selectedSources(),
                    sourceOfWealth = text(binding.etSourceOfWealth).ifBlank { null },
                    accountPurpose = purposeMap[binding.acAccountPurpose.text.toString()] ?: error("Purpose missing"),
                    expectedMonthlyVolumeBand = volumeMap[binding.acExpectedVolume.text.toString()] ?: error("Volume missing"),
                    expectedMonthlyTxCountBand = txCountMap[binding.acExpectedTxCount.text.toString()] ?: error("Count missing"),
                    pepSelfDeclared = binding.cbPepSelf.isChecked,
                    pepRelatedDeclared = binding.cbPepRelated.isChecked,
                    taxResidencies = parseTaxResidencies(),
                    document = KycDocumentRequest(
                        documentType = documentType,
                        issuingCountry = countryCode(binding.acIssuingCountry) ?: error("Issuing country missing"),
                        documentNumber = text(binding.etDocumentNumber),
                        issueDate = text(binding.etDocumentIssueDate).ifBlank { null },
                        expiryDate = text(binding.etDocumentExpiryDate).ifBlank { null },
                        noExpiry = binding.cbDocumentNoExpiry.isChecked,
                        frontPath = frontPath,
                        backPath = backPath,
                        selfiePath = selfiePath
                    ),
                    consents = KycConsentsRequest(
                        privacyAccepted = true,
                        identityVerificationAccepted = true,
                        biometricAccepted = true,
                        ongoingScreeningAccepted = true,
                        privacyNoticeVersion = currentPolicy.privacyNoticeVersion,
                        biometricNoticeVersion = currentPolicy.biometricNoticeVersion
                    )
                )

                when (val result = repo.submitSafe(request)) {
                    is ApiResult.Success -> {
                        toast("Identity verification submitted")
                        idFrontUri = null
                        idBackUri = null
                        selfieUri = null
                        loadPolicyAndProfile()
                    }
                    is ApiResult.Error -> handleKycError(result.error) { submitKyc() }
                }
            } catch (e: KycFlowException) {
                handleKycError(e.appError) { submitKyc() }
            } catch (e: Exception) {
                showServerFailureDialog(message = e.message ?: "KYC submission failed", onRetry = { submitKyc() })
            } finally {
                setLoading(false)
            }
        }
    }

    private suspend fun uploadEvidence(fileType: String, uri: Uri, maxBytes: Long): String {
        val contentType = contentResolver.getType(uri)?.lowercase(Locale.ROOT) ?: "image/jpeg"
        if (contentType !in setOf("image/jpeg", "image/jpg", "image/png")) {
            throw IllegalStateException("Only JPEG or PNG identity images are allowed")
        }

        val bytes = withContext(Dispatchers.IO) { readAllBytes(uri) }
        if (bytes.isEmpty()) throw IllegalStateException("Captured image is empty")
        if (bytes.size.toLong() > maxBytes) throw IllegalStateException("Captured image is too large")

        return when (val uploadResult = repo.uploadUrlSafe(fileType, contentType, 3)) {
            is ApiResult.Error -> throw KycFlowException(uploadResult.error)
            is ApiResult.Success -> {
                withContext(Dispatchers.IO) {
                    SignedUploader.putBytes(uploadResult.data.signedUrl, bytes, contentType)
                }
                uploadResult.data.path
            }
        }
    }

    private fun selectedSources(): List<String> = buildList {
        if (binding.chipSalary.isChecked) add("salary")
        if (binding.chipBusiness.isChecked) add("business")
        if (binding.chipSavings.isChecked) add("savings")
        if (binding.chipInvestments.isChecked) add("investments")
        if (binding.chipFamily.isChecked) add("family_support")
        if (binding.chipOtherFunds.isChecked) add("other")
    }

    private fun parseTaxResidencies(): List<String> = text(binding.etTaxResidencies)
        .split(",")
        .map { it.trim().uppercase(Locale.ROOT) }
        .filter { it.isNotBlank() }
        .distinct()
        .take(10)

    private fun validTaxResidencies(): Boolean = parseTaxResidencies().all { it.matches(Regex("^[A-Z]{2}$")) }

    private fun countryCode(view: com.google.android.material.textfield.MaterialAutoCompleteTextView): String? =
        countryLabelToCode[view.text.toString()]

    private fun text(view: android.widget.EditText): String = view.text?.toString()?.trim().orEmpty()

    private fun readAllBytes(uri: Uri): ByteArray {
        contentResolver.openInputStream(uri).use { input ->
            if (input == null) throw IllegalStateException("Can't open captured image")
            return input.readBytes()
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.btnSubmitKyc.isEnabled = !loading
        binding.btnKycNextStep.isEnabled = !loading
        binding.btnKycBackStep.isEnabled = !loading
        binding.btnPickId.isEnabled = !loading
        binding.btnPickIdBack.isEnabled = !loading
        binding.btnPickSelfie.isEnabled = !loading
        binding.btnSubmitKyc.text = if (loading) "Submitting securely…" else "Submit verification"
    }

    private fun setPageLoading(loading: Boolean) {
        if (loading) {
            binding.tvKycStatusTitle.text = "Loading verification"
            binding.tvKycStatusMessage.text = "Preparing the latest KYC requirements…"
        } else if (!formLocked) {
            binding.tvKycStatusTitle.text = "Verify your identity"
            if (binding.tvKycStatusMessage.text.toString().startsWith("Preparing")) {
                binding.tvKycStatusMessage.text = "Complete the four verification steps below. Long-press this message or the privacy checkbox to open JeezPay's privacy policy."
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
        title: String = "Verification unavailable",
        message: String = "We couldn't complete your request right now.",
        retryText: String = "Try again",
        closeText: String = "Close",
        onRetry: () -> Unit = {}
    ) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_error_retry, null)
        dialogView.findViewById<TextView>(R.id.tvErrorTitle).text = title
        dialogView.findViewById<TextView>(R.id.tvErrorMessage).text = message
        val btnClose = dialogView.findViewById<TextView>(R.id.btnErrorClose)
        val btnRetry = dialogView.findViewById<TextView>(R.id.btnErrorRetry)
        btnClose.text = closeText
        btnRetry.text = retryText
        val dialog = AlertDialog.Builder(this).setView(dialogView).setCancelable(false).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        btnClose.setOnClickListener { dialog.dismiss() }
        btnRetry.setOnClickListener { dialog.dismiss(); onRetry() }
        dialog.show()
    }

    private fun showCustomConfirmDialog(
        message: String,
        confirmText: String = "Confirm",
        cancelText: String = "Cancel",
        onConfirm: () -> Unit = {}
    ) {
        val view = layoutInflater.inflate(R.layout.dialog_action_confirm, null)
        view.findViewById<TextView>(R.id.tvDialogMessage).text = message
        val btnCancel = view.findViewById<TextView>(R.id.btnCancelDialog)
        val btnConfirm = view.findViewById<TextView>(R.id.btnConfirmDialog)
        view.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_warning_red)
        btnCancel.text = cancelText
        btnConfirm.text = confirmText
        val dialog = AlertDialog.Builder(this).setView(view).setCancelable(false).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        btnCancel.setOnClickListener { dialog.dismiss() }
        btnConfirm.setOnClickListener { dialog.dismiss(); onConfirm() }
        dialog.show()
    }

    private fun handleKycError(error: AppError, retryAction: () -> Unit = {}) {
        when (error) {
            is AppError.NoInternet -> showNoInternetDialog(retryAction)
            is AppError.Server -> showServerFailureDialog(message = error.message, onRetry = retryAction)
            is AppError.Validation -> toast(error.message)
            is AppError.Unauthorized -> {
                toast(error.message)
                SessionManager(this).clearAll()
                startActivity(Intent(this, AuthActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    putExtra(AuthActivity.EXTRA_FORCE_LOGIN, true)
                })
                finish()
            }
            is AppError.Unknown -> showServerFailureDialog(message = error.message, onRetry = retryAction)
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private class KycFlowException(val appError: AppError) : Exception()
}
