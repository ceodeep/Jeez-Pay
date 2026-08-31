package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.dto.ProductCapability
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class WithdrawActivity : AppCompatActivity() {

    private val repo = WalletRepository()
    private val productRepo = ProductRepository()

    private val selectedCurrency = "USDT"
    private var selectedNetwork = "TRC20"
    private var cryptoPolicyReady = false
    private var cryptoPolicyLoading = false

    private lateinit var etAddress: TextInputEditText
    private lateinit var etAmount: TextInputEditText
    private lateinit var btnWithdraw: MaterialButton
    private lateinit var progressBar: ProgressBar
    private lateinit var tvCurrency: TextView
    private lateinit var tvNetwork: TextView

    private var pendingAddress = ""
    private var pendingAmount = 0.0

    private val pinLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    submitWithdrawal(pin)
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_withdraw)

        val btnBack = findViewById<View>(R.id.btnBack)
        tvCurrency = findViewById(R.id.tvCurrency)
        tvNetwork = findViewById(R.id.tvNetwork)

        etAddress = findViewById(R.id.etAddress)
        etAmount = findViewById(R.id.etAmount)
        btnWithdraw = findViewById(R.id.btnWithdraw)
        val tvViewHistory = findViewById<TextView>(R.id.tvViewHistory)
        progressBar = findViewById(R.id.progressBar)

        tvViewHistory.setOnClickListener {
            startActivity(Intent(this, WithdrawHistoryActivity::class.java))
        }

        tvCurrency.text = selectedCurrency
        tvNetwork.text = selectedNetwork
        updateNetworkUi()
        setCryptoUiEnabled(false)

        btnBack.setOnClickListener { finish() }

        // This activity implements crypto withdrawal only. Fiat cash-out is a
        // separate launch capability/flow and must not be mixed into this screen.
        tvCurrency.setOnClickListener {
            toast("This withdrawal screen supports USDT only")
        }

        tvNetwork.setOnClickListener {
            if (!requireCryptoWithdrawalPolicy()) return@setOnClickListener
            showNetworkSheet()
        }

        btnWithdraw.setOnClickListener {
            validateAndShowReview()
        }

        loadCryptoWithdrawalPolicy()
    }

    private fun loadCryptoWithdrawalPolicy(forceRefresh: Boolean = false) {
        if (cryptoPolicyLoading) return

        val cached = ProductPolicyStore.current(ProductPolicyStore.GLOBAL_COUNTRY_CODE)
        if (!forceRefresh && cached != null) {
            applyCryptoWithdrawalPolicy(cached)
            return
        }

        cryptoPolicyLoading = true
        cryptoPolicyReady = false
        setCryptoUiEnabled(false)
        updateUnavailableMessage("Checking crypto withdrawal availability...")

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.GLOBAL_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    cryptoPolicyLoading = false
                    ProductPolicyStore.replace(result.data)
                    applyCryptoWithdrawalPolicy(result.data)
                }

                is ApiResult.Error -> {
                    cryptoPolicyLoading = false
                    cryptoPolicyReady = false
                    ProductPolicyStore.clear(ProductPolicyStore.GLOBAL_COUNTRY_CODE)
                    setCryptoUiEnabled(false)
                    updateUnavailableMessage("USDT withdrawals are not available right now")
                }
            }
        }
    }

    private fun applyCryptoWithdrawalPolicy(config: ProductCapabilitiesResponse) {
        ProductPolicyStore.replace(config)

        cryptoPolicyReady = ProductPolicyStore.isCapabilityEnabled(
            selectedCurrency,
            ProductCapability.USDT_SEND,
            ProductPolicyStore.GLOBAL_COUNTRY_CODE
        )

        setCryptoUiEnabled(cryptoPolicyReady)

        if (cryptoPolicyReady) {
            updateNetworkUi()
        } else {
            updateUnavailableMessage("USDT withdrawals are not available right now")
        }
    }

    private fun requireCryptoWithdrawalPolicy(): Boolean {
        val allowed = cryptoPolicyReady && ProductPolicyStore.isCapabilityEnabled(
            selectedCurrency,
            ProductCapability.USDT_SEND,
            ProductPolicyStore.GLOBAL_COUNTRY_CODE
        )

        if (!allowed) {
            toast("USDT withdrawals are not available right now")
        }

        return allowed
    }

    private fun validateAndShowReview() {
        if (!requireCryptoWithdrawalPolicy()) return

        val address = etAddress.text?.toString()?.trim().orEmpty()
        val amount = etAmount.text?.toString()?.toDoubleOrNull() ?: 0.0

        if (address.isBlank()) {
            toast("Enter recipient wallet address")
            return
        }

        if (amount <= 0) {
            toast("Enter a valid amount")
            return
        }

        pendingAddress = address
        pendingAmount = amount

        showReviewSheet(address, amount)
    }

    private fun showReviewSheet(address: String, amount: Double) {
        if (!requireCryptoWithdrawalPolicy()) return

        val fee = 2.0
        val total = amount + fee

        val dialog = BottomSheetDialog(this, R.style.JeezPayBottomSheet)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_withdraw_review, null)

        view.findViewById<TextView>(R.id.tvReviewAddress).text = address

        view.findViewById<TextView>(R.id.tvReviewNetwork).text =
            if (selectedNetwork == "TRC20") {
                "TRON (TRC20)"
            } else {
                "BNB Smart Chain (BEP20)"
            }

        view.findViewById<TextView>(R.id.tvReviewAmount).text = "$amount USDT"
        view.findViewById<TextView>(R.id.tvReviewFee).text = "$fee USDT"
        view.findViewById<TextView>(R.id.tvReviewTotal).text = "$total USDT"

        view.findViewById<MaterialButton>(R.id.btnConfirmWithdrawal).setOnClickListener {
            if (!requireCryptoWithdrawalPolicy()) {
                dialog.dismiss()
                return@setOnClickListener
            }

            dialog.dismiss()
            pinLauncher.launch(Intent(this, PinVerifyActivity::class.java))
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun submitWithdrawal(pin: String) {
        if (!requireCryptoWithdrawalPolicy()) return

        progressBar.visibility = View.VISIBLE
        btnWithdraw.isEnabled = false

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                repo.cryptoWithdrawSafe(
                    toAddress = pendingAddress,
                    amount = pendingAmount,
                    pin = pin,
                    network = selectedNetwork
                )
            }) {
                is ApiResult.Success -> {
                    progressBar.visibility = View.GONE
                    setCryptoUiEnabled(cryptoPolicyReady)

                    showSuccessSheet(
                        amount = result.data.amount ?: pendingAmount,
                        reference = result.data.reference,
                        txHash = result.data.txHash
                    )
                }

                is ApiResult.Error -> {
                    progressBar.visibility = View.GONE
                    setCryptoUiEnabled(cryptoPolicyReady)
                    toast(cleanErrorMessage(result.error))
                }
            }
        }
    }

    private fun cleanErrorMessage(error: Any?): String {
        val raw = error?.toString()?.trim().orEmpty()

        if (raw.isBlank()) {
            return "Something went wrong. Please try again."
        }

        val validationRegex = Regex("""Validation\(message=(.*)\)""")
        val validationMatch = validationRegex.matchEntire(raw)

        if (validationMatch != null) {
            return validationMatch.groupValues[1].trim()
        }

        return raw
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun showNetworkSheet() {
        if (!requireCryptoWithdrawalPolicy()) return

        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_network_picker, null)

        view.findViewById<View>(R.id.rowTrc20).setOnClickListener {
            selectedNetwork = "TRC20"
            updateNetworkUi()
            tvNetwork.text = selectedNetwork
            dialog.dismiss()
        }

        view.findViewById<View>(R.id.rowBep20).setOnClickListener {
            selectedNetwork = "BEP20"
            updateNetworkUi()
            tvNetwork.text = selectedNetwork
            dialog.dismiss()
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun showSuccessSheet(amount: Double, reference: String?, txHash: String?) {
        val dialog = BottomSheetDialog(this, R.style.JeezPayBottomSheet)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_withdraw_success, null)

        view.findViewById<TextView>(R.id.tvSuccessMessage).text =
            "$amount USDT withdrawal has been submitted successfully."

        view.findViewById<TextView>(R.id.tvSuccessReference).text =
            "Reference: ${reference ?: "-"}\nTransaction hash: ${txHash ?: "Processing"}"

        view.findViewById<MaterialButton>(R.id.btnSuccessDone).setOnClickListener {
            dialog.dismiss()
            finish()
        }

        dialog.setContentView(view)
        dialog.show()
    }

    private fun setCryptoUiEnabled(enabled: Boolean) {
        etAddress.isEnabled = enabled
        etAmount.isEnabled = enabled
        btnWithdraw.isEnabled = enabled
        tvNetwork.isEnabled = enabled

        val alpha = if (enabled) 1f else 0.55f
        etAddress.alpha = alpha
        etAmount.alpha = alpha
        btnWithdraw.alpha = alpha
        tvNetwork.alpha = alpha
    }

    private fun updateUnavailableMessage(message: String) {
        findViewById<TextView>(R.id.tvWithdrawBadge).text = "USDT unavailable"
        findViewById<TextView>(R.id.tvWithdrawInfo).text = message
        findViewById<TextView>(R.id.tvWithdrawNetworkInfo).text =
            "Crypto withdrawal is disabled by JeezPay product policy."
    }

    private fun updateNetworkUi() {
        findViewById<TextView>(R.id.tvWithdrawBadge).text = "USDT $selectedNetwork"

        findViewById<TextView>(R.id.tvWithdrawInfo).text =
            if (selectedNetwork == "BEP20") {
                "Withdraw USDT from your JeezPay balance to an external BNB Smart Chain wallet address."
            } else {
                "Withdraw USDT from your JeezPay balance to an external TRON wallet address."
            }

        findViewById<TextView>(R.id.tvWithdrawNetworkInfo).text =
            if (selectedNetwork == "BEP20") {
                "Network: BNB Smart Chain (BEP20)\nMinimum withdrawal: 10 USDT\nWithdrawal fee: 2 USDT"
            } else {
                "Network: TRON (TRC20)\nMinimum withdrawal: 10 USDT\nWithdrawal fee: 2 USDT"
            }
    }
}
