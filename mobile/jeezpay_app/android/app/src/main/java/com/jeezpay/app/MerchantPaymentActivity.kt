package com.jeezpay.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.dto.ConfirmMerchantPaymentRequest
import com.jeezpay.app.network.dto.ConfirmMerchantPaymentResponse
import com.jeezpay.app.network.dto.MerchantPaymentDto
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MerchantPaymentActivity : BaseFintechActivity() {

    companion object {
        const val EXTRA_PAYMENT_ID = "extra_payment_id"
    }

    private lateinit var tvMerchant: TextView
    private lateinit var tvAmount: TextView
    private lateinit var tvDescription: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvPaymentId: TextView
    private lateinit var btnPay: MaterialButton
    private lateinit var btnCancel: MaterialButton

    private var paymentId: String = ""
    private var currentPayment: MerchantPaymentDto? = null

    private val blue = Color.rgb(0, 112, 224)
    private val bg = Color.rgb(245, 247, 251)
    private val textDark = Color.rgb(28, 36, 52)
    private val textMuted = Color.rgb(103, 112, 130)
    private val cardStroke = Color.rgb(224, 231, 240)

    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    confirmPayment(pin)
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.JeezPayTheme)
        super.onCreate(savedInstanceState)

        paymentId =
            intent.getStringExtra(EXTRA_PAYMENT_ID)
                ?: intent.data?.pathSegments?.firstOrNull()
                ?: ""

        if (paymentId.isBlank()) {
            Toast.makeText(this, "Missing merchant payment ID", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        ApiClient.init(SessionManager(this))

        setContentView(buildContent())

        btnPay.setOnClickListener {
            requestPin()
        }

        btnCancel.setOnClickListener {
            finish()
        }

        loadPayment()
    }

    private fun buildContent(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(bg)
            isFillViewport = true
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(24))
        }

        val title = TextView(this).apply {
            text = "Confirm Payment"
            textSize = 26f
            setTextColor(textDark)
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
        }

        val subtitle = TextView(this).apply {
            text = "Review the merchant request before paying"
            textSize = 14f
            setTextColor(textMuted)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(20))
            background = rounded(Color.WHITE, dp(22), cardStroke, 1)
            elevation = dp(2).toFloat()
        }

        val merchantBadge = TextView(this).apply {
            text = "N"
            textSize = 24f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            background = rounded(blue, dp(28))
            layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
        }

        tvMerchant = TextView(this).apply {
            text = "NileLive"
            textSize = 20f
            setTextColor(textDark)
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(12), 0, 0)
        }

        tvAmount = TextView(this).apply {
            text = "SSP 50"
            textSize = 34f
            setTextColor(blue)
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(12), 0, dp(14))
        }

        tvStatus = chip("Loading")

        tvDescription = detailRow("Description", "Loading...")
        tvPaymentId = detailRow("Payment ID", paymentId)

        card.addView(merchantBadge)
        card.addView(tvMerchant)
        card.addView(tvAmount)
        card.addView(tvStatus)
        card.addView(space(18))
        card.addView(divider())
        card.addView(tvDescription)
        card.addView(divider())
        card.addView(tvPaymentId)

        btnPay = MaterialButton(this).apply {
            text = "Confirm and Pay"
            textSize = 15f
            isAllCaps = false
            cornerRadius = dp(14)
            isEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(56)
            ).apply {
                topMargin = dp(22)
            }
        }

        btnCancel = MaterialButton(this).apply {
            text = "Cancel"
            textSize = 15f
            isAllCaps = false
            cornerRadius = dp(14)
            setTextColor(blue)
            background = rounded(Color.TRANSPARENT, dp(14), blue, 1)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(54)
            ).apply {
                topMargin = dp(12)
            }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(space(24))
        root.addView(card)
        root.addView(btnPay)
        root.addView(btnCancel)

        scroll.addView(root)
        return scroll
    }

    private fun detailRow(label: String, value: String): TextView {
        return TextView(this).apply {
            text = "$label\n$value"
            textSize = 15f
            setTextColor(textDark)
            setPadding(0, dp(14), 0, dp(14))
            setLineSpacing(dp(2).toFloat(), 1.0f)
        }
    }

    private fun chip(value: String): TextView {
        return TextView(this).apply {
            text = value.uppercase()
            textSize = 12f
            setTextColor(Color.rgb(126, 87, 0))
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            background = rounded(Color.rgb(255, 244, 214), dp(18))
            setPadding(dp(14), dp(7), dp(14), dp(7))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
        }
    }

    private fun divider(): View {
        return View(this).apply {
            setBackgroundColor(Color.rgb(235, 239, 245))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                1
            )
        }
    }

    private fun space(heightDp: Int): TextView {
        return TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(heightDp)
            )
        }
    }

    private fun rounded(
        color: Int,
        radius: Int,
        strokeColor: Int? = null,
        strokeWidth: Int = 0
    ): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius.toFloat()
            if (strokeColor != null && strokeWidth > 0) {
                setStroke(dp(strokeWidth), strokeColor)
            }
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun setPageLoading(loading: Boolean) {
        btnCancel.isEnabled = !loading

        if (loading) {
            btnPay.isEnabled = false
            btnPay.text = "Loading..."
        } else {
            val payment = currentPayment
            val status = payment?.status ?: ""
            val canPay = status.equals("pending", ignoreCase = true)
            val amount = payment?.amount ?: "-"
            val currency = payment?.currency ?: ""

            btnPay.isEnabled = canPay
            btnPay.text = when {
                status.equals("paid", ignoreCase = true) -> "Already paid"
                canPay -> "Confirm and Pay $currency $amount"
                else -> "Payment $status"
            }
        }
    }

    private fun loadPayment() {
        setPageLoading(true)

        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    ApiClient.merchantPaymentApi.getMerchantPayment(paymentId)
                }

                val payment = response.payment

                if (payment == null) {
                    showError("Payment not found")
                    return@launch
                }

                currentPayment = payment
                renderPayment(payment)
            } catch (error: Exception) {
                showError(error.message ?: "Could not load payment")
            } finally {
                setPageLoading(false)
            }
        }
    }

    private fun renderPayment(payment: MerchantPaymentDto) {
        val merchantName = payment.merchants?.name ?: "Merchant"
        val amount = payment.amount ?: "-"
        val currency = payment.currency ?: "-"
        val status = payment.status ?: "-"

        tvMerchant.text = merchantName
        tvAmount.text = "$currency $amount"
        tvDescription.text = "Description\n${payment.description ?: "-"}"
        tvPaymentId.text = "Payment ID\n${payment.id ?: paymentId}"

        tvStatus.text = status.uppercase()

        if (status.equals("paid", ignoreCase = true)) {
            tvStatus.setTextColor(Color.rgb(18, 125, 70))
            tvStatus.background = rounded(Color.rgb(220, 248, 232), dp(18))
        } else {
            tvStatus.setTextColor(Color.rgb(126, 87, 0))
            tvStatus.background = rounded(Color.rgb(255, 244, 214), dp(18))
        }

        setPageLoading(false)
    }

    private fun requestPin() {
        val payment = currentPayment ?: return

        val amount = payment.amount ?: "-"
        val currency = payment.currency ?: ""
        val merchantName = payment.merchants?.name ?: "merchant"

        val i = Intent(this, PinVerifyActivity::class.java).apply {
            putExtra(PinVerifyActivity.EXTRA_TITLE, "Confirm Payment")
            putExtra(
                PinVerifyActivity.EXTRA_SUBTITLE,
                "Pay $currency $amount to $merchantName"
            )
        }

        pinLauncher.launch(i)
    }

    private fun confirmPayment(pin: String) {
        setPageLoading(true)

        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    ApiClient.merchantPaymentApi.confirmMerchantPayment(
                        paymentId,
                        ConfirmMerchantPaymentRequest(pin = pin)
                    )
                }

                if (response.ok == true) {
                    showSuccess(response)
                } else {
                    showError(response.message ?: "Payment failed")
                    setPageLoading(false)
                }
            } catch (error: Exception) {
                showError(error.message ?: "Payment confirmation failed")
                setPageLoading(false)
            }
        }
    }

    private fun showSuccess(response: ConfirmMerchantPaymentResponse) {
        loadPayment()

        val message = buildString {
            appendLine(response.message ?: "Payment confirmed")
            appendLine()
            appendLine("Amount: ${response.currency ?: ""} ${response.amount ?: ""}")
            appendLine("Reference: ${response.reference ?: "-"}")
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Payment Successful")
            .setMessage(message)
            .setPositiveButton("Return to NileLive") { _, _ ->
                val successUrl = currentPayment?.successUrl
                if (!successUrl.isNullOrBlank()) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(successUrl)))
                    } catch (_: Exception) {
                        finish()
                    }
                } else {
                    finish()
                }
            }
            .setNegativeButton("Done") { _, _ ->
    startActivity(
        Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        }
    )
    finish()
}
            .show()
    }

    private fun showError(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}

