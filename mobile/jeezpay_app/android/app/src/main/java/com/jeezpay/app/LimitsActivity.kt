package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.dto.TransferSettingsResponse
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale

class LimitsActivity : AppCompatActivity() {

    private val walletRepository = WalletRepository()

    private lateinit var tvMinTransferValue: TextView
    private lateinit var tvMaxTransferValue: TextView
    private lateinit var tvTransferFeeValue: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_limits)

        findViewById<View>(R.id.btnBack).setOnClickListener {
            finish()
        }

        tvMinTransferValue =
            findViewById(R.id.tvMinTransferValue)

        tvMaxTransferValue =
            findViewById(R.id.tvMaxTransferValue)

        tvTransferFeeValue =
            findViewById(R.id.tvTransferFeeValue)

        showLoading()
        loadSspTransferSettings()
    }

    private fun loadSspTransferSettings() {
        lifecycleScope.launch {
            when (
                val result = withContext(Dispatchers.IO) {
                    walletRepository.transferSettingsSafe("SSP")
                }
            ) {
                is ApiResult.Success -> {
                    renderSettings(result.data)
                }

                is ApiResult.Error -> {
                    showUnavailable()

                    Toast.makeText(
                        this@LimitsActivity,
                        "Could not load current SSP limits.",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    private fun renderSettings(
        settings: TransferSettingsResponse
    ) {
        if (
            settings.isEnabled != true ||
            !settings.currency.equals(
                "SSP",
                ignoreCase = true
            )
        ) {
            showUnavailable()
            return
        }

        tvMinTransferValue.text =
            formatLimit(settings.minTransfer)

        tvMaxTransferValue.text =
            formatLimit(settings.maxTransfer)

        tvTransferFeeValue.text =
            formatFee(
                feePercent = settings.feePercent,
                flatFee = settings.flatFee
            )
    }

    private fun showLoading() {
        tvMinTransferValue.text = "Loading..."
        tvMaxTransferValue.text = "Loading..."
        tvTransferFeeValue.text = "Loading..."
    }

    private fun showUnavailable() {
        tvMinTransferValue.text = "Unavailable"
        tvMaxTransferValue.text = "Unavailable"
        tvTransferFeeValue.text = "Unavailable"
    }

    private fun formatLimit(
        value: Double?
    ): String {
        if (value == null || value <= 0.0) {
            return "Not configured"
        }

        return "${formatNumber(value)} SSP"
    }

    private fun formatFee(
        feePercent: Double?,
        flatFee: Double?
    ): String {
        val percent =
            feePercent?.takeIf { it > 0.0 } ?: 0.0

        val flat =
            flatFee?.takeIf { it > 0.0 } ?: 0.0

        return when {
            percent > 0.0 && flat > 0.0 ->
                "${formatNumber(flat)} SSP + ${formatNumber(percent)}%"

            flat > 0.0 ->
                "${formatNumber(flat)} SSP"

            percent > 0.0 ->
                "${formatNumber(percent)}%"

            else ->
                "No transfer fee"
        }
    }

    private fun formatNumber(
        value: Double
    ): String {
        val formatter =
            NumberFormat.getNumberInstance(Locale.US)

        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2

        return formatter.format(value)
    }
}
