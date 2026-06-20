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
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.launch
import android.content.Intent

class DepositUsdtActivity : BaseFintechActivity() {

    private val repo = WalletRepository()

    private lateinit var btnBack: View
    private lateinit var ivQrCode: ImageView
    private lateinit var tvAddress: TextView
    private lateinit var btnCopyAddress: MaterialButton
    private lateinit var tvStatus: TextView
    private lateinit var btnDepositHistory: MaterialButton
    private lateinit var tvDepositTitle: TextView
    private lateinit var tvDepositSubtitle: TextView
    private lateinit var tvTrc20: TextView
    private lateinit var tvBep20: TextView
    private var selectedNetwork = "TRC20"

    private var currentAddress: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_deposit_usdt)

        btnBack = findViewById(R.id.btnBack)
        ivQrCode = findViewById(R.id.ivQrCode)
        tvAddress = findViewById(R.id.tvAddress)
        btnCopyAddress = findViewById(R.id.btnCopyAddress)
        btnDepositHistory = findViewById(R.id.btnDepositHistory)
        tvStatus = findViewById(R.id.tvStatus)

        tvDepositTitle = findViewById(R.id.tvDepositTitle)
        tvDepositSubtitle = findViewById(R.id.tvDepositSubtitle)
        tvTrc20 = findViewById(R.id.tvTrc20)
        tvBep20 = findViewById(R.id.tvBep20)

        tvTrc20.setOnClickListener {
            selectedNetwork = "TRC20"
            updateNetworkUi()
            loadDepositAddress()
        }

        tvBep20.setOnClickListener {
            selectedNetwork = "BEP20"
            updateNetworkUi()
            loadDepositAddress()
        }

        updateNetworkUi()

        btnBack.setOnClickListener { finish() }

        btnCopyAddress.setOnClickListener {
            if (currentAddress.isBlank()) {
                toast("Deposit address unavailable")
                return@setOnClickListener
            }

            copyToClipboard("JeezPay USDT $selectedNetwork address", currentAddress)
            toast("Address copied")
        }
        btnDepositHistory.setOnClickListener {
            startActivity(Intent(this, CryptoDepositsActivity::class.java))
        }

        loadDepositAddress()
    }

    private fun loadDepositAddress() {
        setStatus("Loading deposit address...")
        btnCopyAddress.isEnabled = false
        btnCopyAddress.alpha = 0.65f

        lifecycleScope.launch {
            when (val result = repo.cryptoDepositAddressSafe("USDT", selectedNetwork)) {
                is ApiResult.Success -> {
                    val address = result.data.address?.trim().orEmpty()

                    if (address.isBlank()) {
                        currentAddress = ""
                        tvAddress.text = "Address unavailable"
                        ivQrCode.setImageDrawable(null)
                        setStatus("Could not load deposit address")
                        return@launch
                    }

                    currentAddress = address
                    tvAddress.text = currentAddress
                    ivQrCode.setImageBitmap(generateQrBitmap(currentAddress))

                    btnCopyAddress.isEnabled = true
                    btnCopyAddress.alpha = 1f
                    hideStatus()
                }

                is ApiResult.Error -> {
                    currentAddress = ""
                    tvAddress.text = "Address unavailable"
                    ivQrCode.setImageDrawable(null)
                    btnCopyAddress.isEnabled = false
                    btnCopyAddress.alpha = 0.65f
                    setStatus(errorMessage(result.error))
                }
            }
        }
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
    private fun updateNetworkUi() {
        tvDepositTitle.text = "USDT $selectedNetwork Deposit Address"

        tvDepositSubtitle.text =
            if (selectedNetwork == "BEP20") {
                "Send only USDT on the BNB Smart Chain/BEP20 network to this address."
            } else {
                "Send only USDT on the TRON/TRC20 network to this address."
            }

        tvTrc20.setTextColor(
            getColor(if (selectedNetwork == "TRC20") R.color.text_primary else R.color.text_secondary)
        )

        tvBep20.setTextColor(
            getColor(if (selectedNetwork == "BEP20") R.color.text_primary else R.color.text_secondary)
        )
    }
}