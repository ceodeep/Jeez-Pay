package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import com.jeezpay.app.repository.ServicesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ServiceRequestActivity : BaseFintechActivity() {

    private val repo = ServicesRepository()
    private val productRepo = ProductRepository()

    private lateinit var tvTitle: TextView
    private lateinit var etProvider: EditText
    private lateinit var etCustomerReference: EditText
    private lateinit var tvCurrency: TextView
    private lateinit var etAmount: EditText
    private lateinit var etNote: EditText
    private lateinit var tvError: TextView
    private lateinit var btnSubmit: MaterialButton

    private var currencies: Array<String> = emptyArray()
    private var serviceType: String = "other"
    private var selectedCurrency: String = ""
    private var productPolicyLoading = false
    private var productPolicyReady = false
    private var pendingPinAction: ((String) -> Unit)? = null

    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    pendingPinAction?.invoke(pin)
                }
            }
            pendingPinAction = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_service_request)

        serviceType = intent.getStringExtra("serviceType") ?: "other"
        val title = intent.getStringExtra("title") ?: "Service Request"
        val providerHint = intent.getStringExtra("providerHint") ?: "Provider"
        val referenceHint = intent.getStringExtra("referenceHint") ?: "Customer reference"

        findViewById<View>(R.id.btnBack).setOnClickListener { finish() }

        tvTitle = findViewById(R.id.tvTitle)
        etProvider = findViewById(R.id.etProvider)
        etCustomerReference = findViewById(R.id.etCustomerReference)
        tvCurrency = findViewById(R.id.tvCurrency)
        etAmount = findViewById(R.id.etAmount)
        etNote = findViewById(R.id.etNote)
        tvError = findViewById(R.id.tvError)
        btnSubmit = findViewById(R.id.btnSubmit)

        tvTitle.text = title
        etProvider.hint = providerHint
        etProvider.setText(providerHint.takeIf { it != "Provider" } ?: "")
        etCustomerReference.hint = referenceHint
        tvCurrency.text = "--"

        tvCurrency.setOnClickListener {
            showCurrencyPicker()
        }

        btnSubmit.setOnClickListener {
            validateThenPin()
        }

        setLoading(false)
        loadProductPolicy()
    }

    private fun loadProductPolicy(forceRefresh: Boolean = false) {
        if (productPolicyLoading) return

        val cached = ProductPolicyStore.current()
        if (!forceRefresh && cached != null) {
            applyProductPolicy(cached)
            return
        }

        productPolicyLoading = true
        productPolicyReady = false
        setLoading(false)

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    productPolicyLoading = false
                    ProductPolicyStore.replace(result.data)
                    applyProductPolicy(result.data)
                }

                is ApiResult.Error -> {
                    productPolicyLoading = false
                    productPolicyReady = false
                    currencies = emptyArray()
                    selectedCurrency = ""
                    ProductPolicyStore.clear(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
                    tvCurrency.text = "--"
                    setLoading(false)
                    showError(errorMessage(result.error))
                }
            }
        }
    }

    private fun applyProductPolicy(config: ProductCapabilitiesResponse) {
        ProductPolicyStore.replace(config)

        currencies = ProductPolicyStore.enabledCurrencies().toTypedArray()
        if (currencies.isEmpty()) {
            productPolicyReady = false
            selectedCurrency = ""
            tvCurrency.text = "--"
            setLoading(false)
            showError("No payment product is currently available")
            return
        }

        val requestedCurrency = intent.getStringExtra("currency")
            ?.trim()
            ?.uppercase()
            ?.takeIf { it in currencies }

        val defaultCurrency = ProductPolicyStore.defaultCurrency()
            ?.takeIf { it in currencies }

        selectedCurrency = requestedCurrency
            ?: defaultCurrency
            ?: currencies.first()

        productPolicyReady = true
        tvCurrency.text = selectedCurrency
        setLoading(false)
    }

    private fun showCurrencyPicker() {
        if (!productPolicyReady) {
            showError("Payment products are unavailable")
            return
        }

        if (currencies.size <= 1) return

        val checked = currencies.indexOf(selectedCurrency).coerceAtLeast(0)

        MaterialAlertDialogBuilder(this)
            .setTitle("Choose currency")
            .setSingleChoiceItems(currencies, checked) { dialog, which ->
                dialog.dismiss()
                selectedCurrency = currencies[which]
                tvCurrency.text = selectedCurrency
            }
            .show()
    }

    private fun validateThenPin() {
        if (!productPolicyReady ||
            selectedCurrency.isBlank() ||
            !ProductPolicyStore.isCurrencyEnabled(selectedCurrency)
        ) {
            showError("This payment currency is not available right now")
            return
        }

        val provider = etProvider.text.toString().trim()
        val customerReference = etCustomerReference.text.toString().trim()
        val amount = etAmount.text.toString().trim().toDoubleOrNull()
        val note = etNote.text.toString().trim().ifBlank { null }

        if (provider.isBlank()) {
            showError("Provider is required")
            return
        }

        if (customerReference.isBlank()) {
            showError("Customer reference is required")
            return
        }

        if (amount == null || amount <= 0) {
            showError("Enter a valid amount")
            return
        }

        openPinThenSubmit(
            provider = provider,
            customerReference = customerReference,
            currency = selectedCurrency,
            amount = amount,
            note = note
        )
    }

    private fun openPinThenSubmit(
        provider: String,
        customerReference: String,
        currency: String,
        amount: Double,
        note: String?
    ) {
        pendingPinAction = { pin ->
            submitRequest(
                provider = provider,
                customerReference = customerReference,
                currency = currency,
                amount = amount,
                note = note,
                pin = pin
            )
        }

        val i = Intent(this, PinVerifyActivity::class.java).apply {
            putExtra(PinVerifyActivity.EXTRA_TITLE, "Enter your PIN")
            putExtra(PinVerifyActivity.EXTRA_SUBTITLE, "Confirm this service request")
        }

        pinLauncher.launch(i)
    }

    private fun submitRequest(
        provider: String,
        customerReference: String,
        currency: String,
        amount: Double,
        note: String?,
        pin: String
    ) {
        if (!productPolicyReady || !ProductPolicyStore.isCurrencyEnabled(currency)) {
            showError("This payment currency is no longer available")
            return
        }

        setLoading(true)

        lifecycleScope.launch {
            when (val result = repo.createRequestSafe(
                serviceType = serviceType,
                provider = provider,
                customerReference = customerReference,
                currency = currency,
                amount = amount,
                note = note,
                pin = pin
            )) {
                is ApiResult.Success -> {
                    setLoading(false)
                    Toast.makeText(
                        this@ServiceRequestActivity,
                        result.data.message ?: "Service request submitted",
                        Toast.LENGTH_SHORT
                    ).show()

                    startActivity(Intent(this@ServiceRequestActivity, ServiceRequestsActivity::class.java))
                    finish()
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    showError(errorMessage(result.error))
                }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        btnSubmit.isEnabled = !loading && productPolicyReady
        btnSubmit.alpha = if (btnSubmit.isEnabled) 1f else 0.7f
        btnSubmit.text = if (loading) "Submitting..." else "Submit Request"

        etProvider.isEnabled = !loading
        etCustomerReference.isEnabled = !loading
        tvCurrency.isEnabled = !loading && productPolicyReady && currencies.size > 1
        etAmount.isEnabled = !loading && productPolicyReady
        etNote.isEnabled = !loading && productPolicyReady
    }

    private fun showError(message: String) {
        tvError.text = message
        tvError.visibility = View.VISIBLE
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun errorMessage(error: AppError): String {
        return when (error) {
            is AppError.NoInternet -> "No internet connection"
            is AppError.Server -> error.message
            is AppError.Unauthorized -> error.message
            is AppError.Validation -> error.message
            is AppError.Unknown -> error.message
        }
    }
}
