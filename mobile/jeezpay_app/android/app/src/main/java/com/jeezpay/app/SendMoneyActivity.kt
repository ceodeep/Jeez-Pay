package com.jeezpay.app.ui.send

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.widget.ViewFlipper
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.PinVerifyActivity
import com.jeezpay.app.R
import com.jeezpay.app.storage.RecentRecipientsStore
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.launch
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ✅ Make sure this matches your actual BottomSheet package
import com.jeezpay.app.SendReviewBottomSheet

class SendMoneyActivity : AppCompatActivity() {

    private lateinit var vm: SendMoneyViewModel
    private lateinit var sendFlipper: ViewFlipper

    // PAGE 0
    private lateinit var etPhone: EditText
    private lateinit var btnNext: TextView
    private lateinit var ivBack: View
    private lateinit var btnUid: TextView
    private lateinit var btnPhone: TextView
    private lateinit var recentStore: RecentRecipientsStore
    private lateinit var recentList: LinearLayout

    // PAGE 1
    private lateinit var etAmount: EditText
    private lateinit var ddCurrency: TextView
    private lateinit var currencyPill: View
    private lateinit var etDesc: EditText
    private lateinit var btnSend: TextView
    private lateinit var progress: ProgressBar
    private lateinit var tvError: TextView

    private lateinit var tvFee: TextView
    private lateinit var tvRecipientName: TextView
    private lateinit var tvAvailable: TextView

    private val currencies = arrayOf("USDT", "SDG", "SSP", "EGP", "UGX")
    private val df = DecimalFormat("#,##0.##")

    private enum class IdMode { UID, PHONE }
    private var idMode: IdMode = IdMode.UID

    // =========================
    // ✅ PIN FLOW (CLEAN VERSION)
    // =========================
    private var pendingAction: ((String) -> Unit)? = null

    private val pinLauncher =
        registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val pin = result.data?.getStringExtra(com.jeezpay.app.PinVerifyActivity.RESULT_PIN)
                if (!pin.isNullOrBlank()) {
                    pendingAction?.invoke(pin)
                }
            }
            pendingAction = null
        }

    private fun openPinThenConfirm(onConfirmAfterPin: (String) -> Unit) {
        pendingAction = { pin ->
            onConfirmAfterPin(pin)
            pendingAction = null
        }

        val i = Intent(this, com.jeezpay.app.PinVerifyActivity::class.java).apply {
            putExtra(com.jeezpay.app.PinVerifyActivity.EXTRA_TITLE, "Enter your PIN")
            putExtra(com.jeezpay.app.PinVerifyActivity.EXTRA_SUBTITLE, "Kindly enter your transaction PIN to continue")
        }
        pinLauncher.launch(i)
    }

    // =========================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_send_money)

        vm = ViewModelProvider(this)[SendMoneyViewModel::class.java]
        vm.loadBalances()

        sendFlipper = findViewById(R.id.sendFlipper)

        etPhone = findViewById(R.id.etPhone)
        btnNext = findViewById(R.id.btnNext)
        btnUid = findViewById(R.id.btnUid)
        btnPhone = findViewById(R.id.btnPhone)
        recentStore = RecentRecipientsStore(this)
        recentList = findViewById(R.id.recentList)
        ivBack = findViewById(R.id.ivBack)

        etAmount = findViewById(R.id.etAmount)
        ddCurrency = findViewById(R.id.ddCurrency)
        currencyPill = findViewById(R.id.currencyPill)
        etDesc = findViewById(R.id.etDesc)
        btnSend = findViewById(R.id.btnSend)
        progress = findViewById(R.id.progress)
        tvError = findViewById(R.id.tvError)

        tvFee = findViewById(R.id.tvFee)
        tvRecipientName = findViewById(R.id.tvRecipientName)
        tvAvailable = findViewById(R.id.tvAvailable)

        sendFlipper.displayedChild = 0
        ivBack.setOnClickListener {
            if (sendFlipper.displayedChild == 1) {
                sendFlipper.displayedChild = 0
                tvError.visibility = View.GONE
            } else {
                finish()
            }
        }



        setMode(IdMode.UID)
        setNextEnabled(false)
        renderRecentRecipients()

        btnUid.setOnClickListener { setMode(IdMode.UID) }
        btnPhone.setOnClickListener { setMode(IdMode.PHONE) }

        etPhone.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                setNextEnabled(!s.isNullOrBlank())
            }
            override fun afterTextChanged(s: Editable?) {}
        })



        btnNext.setOnClickListener {
            val receiverIdentifier = etPhone.text.toString().trim()
            if (receiverIdentifier.isEmpty()) {
                showError("Receiver UID or phone is required")
                return@setOnClickListener
            }

            sendFlipper.displayedChild = 1
            tvRecipientName.text = receiverIdentifier
        }

        ddCurrency.text = "SSP"
        refreshFeeAndAvailable()

        currencyPill.setOnClickListener { showCurrencyPicker() }

        // =========================
        // SEND BUTTON
        // =========================
        btnSend.setOnClickListener {

            val receiverIdentifier = etPhone.text.toString().trim()
            val amountText = etAmount.text.toString().trim()
            val currency = ddCurrency.text.toString().trim().uppercase()
            val description = etDesc.text.toString().trim().ifEmpty { null }

            val amount = amountText.toDoubleOrNull()

            if (receiverIdentifier.isEmpty()) {
                showError("Receiver UID or phone is required")
                return@setOnClickListener
            }

            if (amount == null || amount <= 0) {
                showError("Enter a valid amount")
                return@setOnClickListener
            }

            if (currency !in currencies) {
                showError("Select a valid currency")
                return@setOnClickListener
            }

            val fee = calcFixedFee(currency)
            val available = vm.availableFor(currency)
            val total = amount + fee

            if (total > available) {
                showError("Insufficient balance")
                return@setOnClickListener
            }

            SendReviewBottomSheet(
                receiverIdentifier = receiverIdentifier,
                recipientDisplay = tvRecipientName.text.toString(),
                currency = currency,
                amount = amount,
                fee = fee
            ) {
                // ✅ PIN FIRST
                openPinThenConfirm { pin ->
                    vm.sendMoney(
                        toPhone = receiverIdentifier,
                        currency = currency,
                        amount = amount,
                        description = description,
                        pin = pin
                    )
                }
            }.show(supportFragmentManager, "SendReviewBottomSheet")
        }

        // =========================
        // STATE OBSERVER
        // =========================
        lifecycleScope.launch {
            vm.state.collect { state ->
                when (state) {
                    is SendMoneyUiState.Idle -> {
                        progress.visibility = View.GONE
                        btnSend.isEnabled = true
                    }

                    is SendMoneyUiState.Loading -> {
                        progress.visibility = View.VISIBLE
                        btnSend.isEnabled = false
                    }

                    is SendMoneyUiState.Error -> {
                        progress.visibility = View.GONE
                        btnSend.isEnabled = true
                        showError(state.message)
                    }

                    is SendMoneyUiState.Success -> {
                        progress.visibility = View.GONE
                        btnSend.isEnabled = true

                        val res = state.res
                        recentStore.add(
                            etPhone.text.toString().trim(),
                            tvRecipientName.text.toString().trim()
                        )
                        renderRecentRecipients()

                        vm.loadBalances()

                        openReceipt(
                            toPhone = etPhone.text.toString().trim(),
                            currency = res.currency ?: "-",
                            amount = res.amount ?: 0.0,
                            description = etDesc.text.toString().trim(),
                            createdAtIso = nowLocal(),
                            reference = res.reference ?: "-"
                        )

                        vm.reset()
                    }
                }
            }
        }
    }

    private fun calcFixedFee(cur: String): Double {
        return when (cur.uppercase()) {
            "USDT", "USD" -> 0.0
            "SSP" -> 270.0
            "SDG" -> 172.0
            "EGP" -> 30.0
            "UGX" -> 168.0
            else -> 0.0
        }
    }

    private fun refreshFeeAndAvailable() {
        val cur = ddCurrency.text.toString().uppercase()
        val fee = calcFixedFee(cur)

        tvFee.text = "Fee: ${df.format(fee)} $cur"

        val avail = vm.availableFor(cur)
        tvAvailable.text = "Available: ${df.format(avail)}"
    }

    private fun showCurrencyPicker() {
        val current = ddCurrency.text.toString().uppercase()
        val checked = currencies.indexOf(current).coerceAtLeast(0)

        MaterialAlertDialogBuilder(this)
            .setTitle("Choose currency")
            .setSingleChoiceItems(currencies, checked) { dialog, which ->
                ddCurrency.text = currencies[which]
                dialog.dismiss()
                refreshFeeAndAvailable()
                vm.loadBalances()
            }
            .show()
    }

    private fun setMode(mode: IdMode) {
        idMode = mode
        etPhone.text?.clear()

        if (mode == IdMode.UID) {
            etPhone.hint = "UID"
            etPhone.inputType = android.text.InputType.TYPE_CLASS_NUMBER
        } else {
            etPhone.hint = "Phone"
            etPhone.inputType = android.text.InputType.TYPE_CLASS_PHONE
        }

        setNextEnabled(false)
    }

    private fun setNextEnabled(enabled: Boolean) {
        btnNext.isEnabled = enabled
        btnNext.alpha = if (enabled) 1f else 0.75f
    }

    private fun showError(msg: String) {
        tvError.text = msg
        tvError.visibility = View.VISIBLE
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun openReceipt(
        toPhone: String,
        currency: String,
        amount: Double,
        description: String?,
        createdAtIso: String,
        reference: String
    ) {
        val fromPhone = SessionManager(this).getPhone() ?: "-"

        val i = Intent(this, com.jeezpay.app.ui.receipt.ReceiptActivity::class.java).apply {
            putExtra("toPhone", toPhone)
            putExtra("fromPhone", fromPhone)
            putExtra("currency", currency)
            putExtra("amount", amount)
            putExtra("description", description ?: "")
            putExtra("createdAt", createdAtIso)
            putExtra("reference", reference)
        }
        startActivity(i)
        finish()
    }

    private fun nowLocal(): String {
        val sdf = SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.getDefault())
        return sdf.format(Date())
    }

    private fun renderRecentRecipients() {
        val items = recentStore.list(10)
        recentList.removeAllViews()

        items.forEach { rec ->
            val row = layoutInflater.inflate(R.layout.item_recent_recipient, recentList, false)
            val tvName = row.findViewById<TextView>(R.id.tvRecentName)
            val tvId = row.findViewById<TextView>(R.id.tvRecentId)

            tvName.text = rec.displayName ?: "Recipient"
            tvId.text = rec.identifier

            row.setOnClickListener {
                etPhone.setText(rec.identifier)
                sendFlipper.displayedChild = 1
                tvRecipientName.text = rec.displayName ?: rec.identifier
            }

            recentList.addView(row)
        }
    }


}