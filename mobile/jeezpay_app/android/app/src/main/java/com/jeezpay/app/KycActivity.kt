package com.jeezpay.app

import android.app.DatePickerDialog
import android.net.Uri
import android.os.Bundle
import android.widget.ImageView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputEditText
import java.util.Calendar
import java.util.Locale

class KycActivity : AppCompatActivity() {

    private lateinit var toolbar: MaterialToolbar

    private lateinit var etFullName: TextInputEditText
    private lateinit var etDob: TextInputEditText
    private lateinit var etAddress: TextInputEditText

    private lateinit var cardIdUpload: MaterialCardView
    private lateinit var cardSelfieUpload: MaterialCardView

    private lateinit var imgIdPreview: ImageView
    private lateinit var imgSelfiePreview: ImageView

    private lateinit var btnPickId: MaterialButton
    private lateinit var btnPickSelfie: MaterialButton
    private lateinit var btnSubmit: MaterialButton

    private var idUri: Uri? = null
    private var selfieUri: Uri? = null

    private val pickId = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            idUri = uri
            imgIdPreview.setImageURI(uri)
        }
        updateSubmitState()
    }

    private val pickSelfie = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            selfieUri = uri
            imgSelfiePreview.setImageURI(uri)
        }
        updateSubmitState()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_kyc)

        bindViews()
        setupUi()
        updateSubmitState()
    }

    private fun bindViews() {
        toolbar = findViewById(R.id.toolbarKyc)

        etFullName = findViewById(R.id.etFullName)
        etDob = findViewById(R.id.etDob)
        etAddress = findViewById(R.id.etAddress)

        cardIdUpload = findViewById(R.id.cardIdUpload)
        cardSelfieUpload = findViewById(R.id.cardSelfieUpload)

        imgIdPreview = findViewById(R.id.imgIdPreview)
        imgSelfiePreview = findViewById(R.id.imgSelfiePreview)

        btnPickId = findViewById(R.id.btnPickId)
        btnPickSelfie = findViewById(R.id.btnPickSelfie)
        btnSubmit = findViewById(R.id.btnSubmitKyc)
    }

    private fun setupUi() {
        // Back arrow
        toolbar.setNavigationOnClickListener { finish() }

        // DOB picker
        etDob.setOnClickListener { showDobPicker() }

        // Pickers (card + button both work)
        cardIdUpload.setOnClickListener { pickId.launch("image/*") }
        btnPickId.setOnClickListener { pickId.launch("image/*") }

        cardSelfieUpload.setOnClickListener { pickSelfie.launch("image/*") }
        btnPickSelfie.setOnClickListener { pickSelfie.launch("image/*") }

        btnSubmit.setOnClickListener {
            val fullName = etFullName.text?.toString()?.trim().orEmpty()
            val dob = etDob.text?.toString()?.trim().orEmpty()
            val address = etAddress.text?.toString()?.trim().orEmpty()

            if (fullName.length < 3) {
                toast("Enter your full name")
                return@setOnClickListener
            }
            if (dob.isBlank()) {
                toast("Pick your date of birth")
                return@setOnClickListener
            }
            if (address.length < 5) {
                toast("Enter your address")
                return@setOnClickListener
            }
            if (idUri == null || selfieUri == null) {
                toast("Upload ID and selfie")
                return@setOnClickListener
            }

            // Next step: call your backend /kyc/upload-url then /kyc/submit
            toast("KYC UI OK ✅ Next: upload to Supabase + submit")
            finish()
        }
    }

    private fun updateSubmitState() {
        val fullNameOk = !etFullName.text.isNullOrBlank()
        val dobOk = !etDob.text.isNullOrBlank()
        val addressOk = !etAddress.text.isNullOrBlank()
        val docsOk = (idUri != null && selfieUri != null)

        btnSubmit.isEnabled = fullNameOk && dobOk && addressOk && docsOk
        btnSubmit.alpha = if (btnSubmit.isEnabled) 1f else 0.6f
    }

    private fun showDobPicker() {
        val cal = Calendar.getInstance()
        val y = cal.get(Calendar.YEAR)
        val m = cal.get(Calendar.MONTH)
        val d = cal.get(Calendar.DAY_OF_MONTH)

        DatePickerDialog(this, { _, year, month, day ->
            // YYYY-MM-DD
            val mm = String.format(Locale.US, "%02d", month + 1)
            val dd = String.format(Locale.US, "%02d", day)
            etDob.setText("$year-$mm-$dd")
            updateSubmitState()
        }, y, m, d).show()
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }
}
