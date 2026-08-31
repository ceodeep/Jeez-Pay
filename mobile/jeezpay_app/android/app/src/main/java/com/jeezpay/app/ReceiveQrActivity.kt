package com.jeezpay.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.ProductCapability
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.repository.AuthRepository
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ReceiveQrActivity : AppCompatActivity() {

    private val authRepo = AuthRepository()
    private val productRepo = ProductRepository()

    private lateinit var btnBack: View
    private lateinit var ivQrCode: ImageView
    private lateinit var tvAccountNumber: TextView
    private lateinit var btnCopyAccountNumber: View
    private lateinit var tvStatus: TextView

    private var currentAccountNumber: String = ""
    private var receiveCurrency: String = ""
    private var receivePolicyReady = false
    private var receivePolicyLoading = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_receive_qr)

        btnBack = findViewById(R.id.btnBack)
        ivQrCode = findViewById(R.id.ivQrCode)
        tvAccountNumber = findViewById(R.id.tvAccountNumber)
        btnCopyAccountNumber = findViewById(R.id.btnCopyAccountNumber)
        tvStatus = findViewById(R.id.tvStatus)

        btnBack.setOnClickListener {
            finish()
        }

        btnCopyAccountNumber.setOnClickListener {
            if (!receivePolicyReady) {
                toast("Receiving is not available right now")
                return@setOnClickListener
            }

            if (currentAccountNumber.isBlank()) {
                toast("Account number unavailable")
                return@setOnClickListener
            }

            copyToClipboard("JeezPay account number", currentAccountNumber)
            toast("Account number copied")
        }

        clearReceiveUi()
        loadReceivePolicy()
    }

    private fun loadReceivePolicy(forceRefresh: Boolean = false) {
        if (receivePolicyLoading) return

        val cached = ProductPolicyStore.current()
        if (!forceRefresh && cached != null) {
            applyReceivePolicy(cached)
            return
        }

        receivePolicyLoading = true
        receivePolicyReady = false
        setStatus("Loading receive options...")

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    receivePolicyLoading = false
                    ProductPolicyStore.replace(result.data)
                    applyReceivePolicy(result.data)
                }

                is ApiResult.Error -> {
                    receivePolicyLoading = false
                    receivePolicyReady = false
                    ProductPolicyStore.clear()
                    clearReceiveUi()
                    setStatus(errorMessage(result.error))
                }
            }
        }
    }

    private fun applyReceivePolicy(config: ProductCapabilitiesResponse) {
        ProductPolicyStore.replace(config)

        val allowedCurrencies = ProductPolicyStore
            .currenciesWithCapability(ProductCapability.P2P_TRANSFER)

        if (allowedCurrencies.isEmpty()) {
            failReceivePolicy("Receiving is not available right now")
            return
        }

        val requested = intent.getStringExtra("currency")
            ?.trim()
            ?.uppercase()
            ?.takeIf { it in allowedCurrencies }

        val defaultCurrency = ProductPolicyStore.defaultCurrency()
            ?.takeIf { it in allowedCurrencies }

        receiveCurrency = requested
            ?: defaultCurrency
            ?: allowedCurrencies.first()

        receivePolicyReady = ProductPolicyStore.isCapabilityEnabled(
            receiveCurrency,
            ProductCapability.P2P_TRANSFER
        )

        if (!receivePolicyReady) {
            failReceivePolicy("Receiving is not available right now")
            return
        }

        loadAccountNumber()
    }

    private fun failReceivePolicy(message: String) {
        receivePolicyLoading = false
        receivePolicyReady = false
        receiveCurrency = ""
        clearReceiveUi()
        setStatus(message)
    }

    private fun loadAccountNumber() {
        if (!receivePolicyReady) {
            failReceivePolicy("Receiving is not available right now")
            return
        }

        setStatus("Loading QR code...")

        lifecycleScope.launch {
            when (val result = authRepo.meSafe()) {
                is ApiResult.Success -> {
                    if (!receivePolicyReady || !ProductPolicyStore.isCapabilityEnabled(
                            receiveCurrency,
                            ProductCapability.P2P_TRANSFER
                        )
                    ) {
                        failReceivePolicy("Receiving is not available right now")
                        return@launch
                    }

                    val accountNumber = result.data.user
                        ?.wallet_account_number
                        ?.toString()
                        ?.trim()
                        .orEmpty()

                    if (accountNumber.isBlank()) {
                        clearReceiveUi()
                        setStatus("Account number unavailable")
                        return@launch
                    }

                    currentAccountNumber = accountNumber
                    tvAccountNumber.text = "Account No: $currentAccountNumber"

                    val qrContent =
                        "jeezpay://pay?uid=$currentAccountNumber&currency=$receiveCurrency"
                    ivQrCode.setImageBitmap(generateQrBitmap(qrContent))
                    hideStatus()
                }

                is ApiResult.Error -> {
                    clearReceiveUi()
                    setStatus(errorMessage(result.error))
                }
            }
        }
    }

    private fun clearReceiveUi() {
        currentAccountNumber = ""
        if (::tvAccountNumber.isInitialized) tvAccountNumber.text = "Account No: -"
        if (::ivQrCode.isInitialized) ivQrCode.setImageDrawable(null)
    }

    private fun generateQrBitmap(content: String): Bitmap {
        val size = 720
        val bits = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)

        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)

        for (x in 0 until size) {
            for (y in 0 until size) {
                bitmap.setPixel(
                    x,
                    y,
                    if (bits[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
                )
            }
        }

        return bitmap
    }

    private fun copyToClipboard(label: String, value: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText(label, value)
        clipboard.setPrimaryClip(clip)
    }

    private fun setStatus(message: String) {
        tvStatus.text = message
        tvStatus.visibility = View.VISIBLE
    }

    private fun hideStatus() {
        tvStatus.text = ""
        tvStatus.visibility = View.GONE
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

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
