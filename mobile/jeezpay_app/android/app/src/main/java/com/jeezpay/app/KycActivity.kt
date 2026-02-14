package com.jeezpay.app

import android.app.DatePickerDialog
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputEditText
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class KycActivity : AppCompatActivity() {

    private lateinit var toolbar: MaterialToolbar

    // Inputs (from your XML)
    private lateinit var etFullName: TextInputEditText
    private lateinit var etDob: TextInputEditText
    private lateinit var etAddress: TextInputEditText

    // Uploads (from your XML)
    private lateinit var cardIdUpload: MaterialCardView
    private lateinit var imgIdPreview: android.widget.ImageView
    private lateinit var btnPickId: MaterialButton

    private lateinit var cardSelfieUpload: MaterialCardView
    private lateinit var imgSelfiePreview: android.widget.ImageView
    private lateinit var btnPickSelfie: MaterialButton

    private lateinit var btnSubmit: MaterialButton

    private var idPhotoUri: Uri? = null
    private var selfieUri: Uri? = null

    private val pickIdPhoto =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            if (uri != null) {
                idPhotoUri = uri
                imgIdPreview.setImageURI(uri)
                btnPickId.text = "ID photo selected"
                updateSubmitEnabled()
            }
        }

    private val pickSelfie =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            if (uri != null) {
                selfieUri = uri
                imgSelfiePreview.setImageURI(uri)
                btnPickSelfie.text = "Selfie selected"
                updateSubmitEnabled()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_kyc)

        bindViews()
        setupToolbar()
        setupDobPicker()
        setupUploads()
        setupSubmit()

        updateSubmitEnabled()
    }

    private fun bindViews() {
        toolbar = findViewById(R.id.toolbarKyc)

        etFullName = findViewById(R.id.etFullName)
        etDob = findViewById(R.id.etDob)
        etAddress = findViewById(R.id.etAddress)

        cardIdUpload = findViewById(R.id.cardIdUpload)
        imgIdPreview = findViewById(R.id.imgIdPreview)
        btnPickId = findViewById(R.id.btnPickId)

        cardSelfieUpload = findViewById(R.id.cardSelfieUpload)
        imgSelfiePreview = findViewById(R.id.imgSelfiePreview)
        btnPickSelfie = findViewById(R.id.btnPickSelfie)

        btnSubmit = findViewById(R.id.btnSubmitKyc)
    }

    private fun setupToolbar() {
        // Back arrow in toolbar (if you have navigationIcon in XML it will show)
        toolbar.setNavigationOnClickListener { finish() }
    }

    private fun setupDobPicker() {
        // Your XML makes it non-focusable + clickable, good.
        etDob.setOnClickListener {
            val cal = Calendar.getInstance()
            val dialog = DatePickerDialog(
                this,
                { _, year, month, day ->
                    val picked = Calendar.getInstance().apply {
                        set(Calendar.YEAR, year)
                        set(Calendar.MONTH, month)
                        set(Calendar.DAY_OF_MONTH, day)
                    }
                    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                    etDob.setText(fmt.format(picked.time))
                    updateSubmitEnabled()
                },
                cal.get(Calendar.YEAR),
                cal.get(Calendar.MONTH),
                cal.get(Calendar.DAY_OF_MONTH)
            )

            // Optional: require user >= 16 years
            val max = Calendar.getInstance().apply { add(Calendar.YEAR, -16) }
            dialog.datePicker.maxDate = max.timeInMillis

            dialog.show()
        }
    }

    private fun setupUploads() {
        // Make both card and button clickable (better UX)
        cardIdUpload.setOnClickListener { pickIdPhoto.launch("image/*") }
        btnPickId.setOnClickListener { pickIdPhoto.launch("image/*") }

        cardSelfieUpload.setOnClickListener { pickSelfie.launch("image/*") }
        btnPickSelfie.setOnClickListener { pickSelfie.launch("image/*") }
    }

    private fun setupSubmit() {
        btnSubmit.setOnClickListener {
            if (!isFormValid()) {
                Toast.makeText(this, "Please complete all fields and uploads", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // TODO (Milestone 2): upload files + save KYC to backend
            Toast.makeText(this, "KYC submitted (UI ready). Next: save to backend.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun isFormValid(): Boolean {
        val nameOk = !etFullName.text.isNullOrBlank() && etFullName.text.toString().trim().length >= 3
        val dobOk = !etDob.text.isNullOrBlank()
        val addressOk = !etAddress.text.isNullOrBlank() && etAddress.text.toString().trim().length >= 5
        val uploadsOk = (idPhotoUri != null && selfieUri != null)
        return nameOk && dobOk && addressOk && uploadsOk
    }

    private fun updateSubmitEnabled() {
        btnSubmit.isEnabled = isFormValid()
        btnSubmit.alpha = if (btnSubmit.isEnabled) 1f else 0.6f
    }
}
