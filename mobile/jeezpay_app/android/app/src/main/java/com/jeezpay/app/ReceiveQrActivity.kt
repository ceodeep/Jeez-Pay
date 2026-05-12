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
import com.jeezpay.app.repository.AuthRepository
import kotlinx.coroutines.launch

class ReceiveQrActivity : AppCompatActivity() {

    private val authRepo = AuthRepository()

    private lateinit var btnBack: View
    private lateinit var ivQrCode: ImageView
    private lateinit var tvAccountNumber: TextView
    private lateinit var btnCopyAccountNumber: View
    private lateinit var tvStatus: TextView

    private var currentAccountNumber: String = ""

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
            if (currentAccountNumber.isBlank()) {
                toast("Account number unavailable")
                return@setOnClickListener
            }

            copyToClipboard("JeezPay account number", currentAccountNumber)
            toast("Account number copied")
        }

        loadAccountNumber()
    }

    private fun loadAccountNumber() {
        setStatus("Loading QR code...")

        lifecycleScope.launch {
            when (val result = authRepo.meSafe()) {
                is ApiResult.Success -> {
                    val accountNumber = result.data.user
                        ?.wallet_account_number
                        ?.toString()
                        ?.trim()
                        .orEmpty()

                    if (accountNumber.isBlank()) {
                        currentAccountNumber = ""
                        tvAccountNumber.text = "Account No: -"
                        ivQrCode.setImageDrawable(null)
                        setStatus("Account number unavailable")
                        return@launch
                    }

                    currentAccountNumber = accountNumber
                    tvAccountNumber.text = "Account No: $currentAccountNumber"

                    val qrContent = "jeezpay://pay?uid=$currentAccountNumber"
                    ivQrCode.setImageBitmap(generateQrBitmap(qrContent))
                    hideStatus()
                }

                is ApiResult.Error -> {
                    currentAccountNumber = ""
                    tvAccountNumber.text = "Account No: -"
                    ivQrCode.setImageDrawable(null)
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
}