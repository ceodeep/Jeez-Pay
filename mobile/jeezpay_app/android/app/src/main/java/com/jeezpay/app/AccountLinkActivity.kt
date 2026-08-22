package com.jeezpay.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiClient
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.AccountLinkDto
import com.jeezpay.app.network.dto.ApproveAccountLinkRequest
import com.jeezpay.app.network.safeApiCall
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AccountLinkActivity : BaseFintechActivity() {

    companion object {
        const val EXTRA_ACCOUNT_LINK_ID =
            "extra_account_link_id"

        private const val PREFS_NAME =
            "jeezpay_prefs"

        private const val PREF_PENDING_ACCOUNT_LINK =
            "pending_account_link_id"
    }

    private lateinit var session: SessionManager

    private lateinit var ivBack: ImageView
    private lateinit var tvMerchantBadge: TextView
    private lateinit var tvMerchant: TextView
    private lateinit var tvRequestMessage: TextView
    private lateinit var tvSubject: TextView
    private lateinit var tvPermissions: TextView
    private lateinit var tvStatus: TextView
    private lateinit var btnConnect: MaterialButton
    private lateinit var btnNotNow: MaterialButton

    private var accountLinkId: String = ""
    private var currentLink: AccountLinkDto? = null

    private val pinLauncher =
        registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val pin = result.data
                    ?.getStringExtra(
                        PinVerifyActivity.RESULT_PIN
                    )

                if (!pin.isNullOrBlank()) {
                    approveLink(pin)
                }
            }
        }

    override fun onCreate(
        savedInstanceState: Bundle?
    ) {
        setTheme(R.style.JeezPayTheme)
        super.onCreate(savedInstanceState)

        accountLinkId =
            intent.getStringExtra(
                EXTRA_ACCOUNT_LINK_ID
            )
                ?: intent.data
                    ?.pathSegments
                    ?.firstOrNull()
                ?: ""

        if (accountLinkId.isBlank()) {
            Toast.makeText(
                this,
                "Missing account connection request",
                Toast.LENGTH_LONG
            ).show()

            finish()
            return
        }

        session = SessionManager(this)
        ApiClient.init(session)

        setContentView(
            R.layout.activity_account_link
        )

        initBlockingLoader()
        bindViews()
        setupClicks()
        loadLink()
    }

    private fun bindViews() {
        ivBack = findViewById(R.id.ivBack)
        tvMerchantBadge =
            findViewById(R.id.tvMerchantBadge)
        tvMerchant =
            findViewById(R.id.tvMerchant)
        tvRequestMessage =
            findViewById(R.id.tvRequestMessage)
        tvSubject =
            findViewById(R.id.tvSubject)
        tvPermissions =
            findViewById(R.id.tvPermissions)
        tvStatus =
            findViewById(R.id.tvStatus)
        btnConnect =
            findViewById(R.id.btnConnect)
        btnNotNow =
            findViewById(R.id.btnNotNow)
    }

    private fun setupClicks() {
        ivBack.setOnClickListener {
            finish()
        }

        btnNotNow.setOnClickListener {
            finish()
        }

        btnConnect.setOnClickListener {
            requestPin()
        }
    }

    private fun loadLink() {
        setPageLoading(true)

        lifecycleScope.launch {
            val result = withContext(
                Dispatchers.IO
            ) {
                safeApiCall {
                    ApiClient.accountLinkApi
                        .getAccountLink(
                            accountLinkId
                        )
                }
            }

            when (result) {
                is ApiResult.Success -> {
                    setPageLoading(false)

                    val link =
                        result.data.accountLink

                    if (link == null) {
                        showServerFailureDialog(
                            message =
                                "Could not load this account connection request.",
                            onRetry = {
                                loadLink()
                            }
                        )

                        return@launch
                    }

                    currentLink = link
                    renderLink(link)
                }

                is ApiResult.Error -> {
                    setPageLoading(false)
                    handleLoadError(
                        result.error
                    )
                }
            }
        }
    }

    private fun renderLink(
        link: AccountLinkDto
    ) {
        val merchantName =
            link.merchant
                ?.name
                ?.trim()
                ?.takeIf {
                    it.isNotBlank()
                }
                ?: "Merchant"

        tvMerchant.text = merchantName

        tvMerchantBadge.text =
            merchantName
                .firstOrNull()
                ?.uppercase()
                ?: "M"

        tvRequestMessage.text =
            "$merchantName wants to connect to your JeezPay account"

        val subject =
            link.subjectHint
                ?.trim()
                .orEmpty()

        if (subject.isBlank()) {
            tvSubject.visibility =
                View.GONE
        } else {
            tvSubject.visibility =
                View.VISIBLE

            tvSubject.text = subject
        }

        tvPermissions.text =
            link.permissions
                .filter {
                    it.isNotBlank()
                }
                .joinToString(
                    separator = "\n\n"
                ) {
                    "\u2022 $it"
                }
                .ifBlank {
                    "Account connection permissions unavailable"
                }

        val status =
            link.status
                ?.trim()
                ?.lowercase()
                .orEmpty()

        tvStatus.text =
            status.ifBlank {
                "unknown"
            }.uppercase()

        when (status) {
            "pending" -> {
                btnConnect.isEnabled = true
                btnConnect.alpha = 1f
                btnConnect.text =
                    "Connect $merchantName"
            }

            "approved" -> {
                btnConnect.isEnabled = false
                btnConnect.alpha = 0.6f
                btnConnect.text =
                    "Connection approved"
            }

            "consumed" -> {
                btnConnect.isEnabled = false
                btnConnect.alpha = 0.6f
                btnConnect.text =
                    "Already connected"
            }

            "expired" -> {
                btnConnect.isEnabled = false
                btnConnect.alpha = 0.6f
                btnConnect.text =
                    "Request expired"
            }

            "cancelled" -> {
                btnConnect.isEnabled = false
                btnConnect.alpha = 0.6f
                btnConnect.text =
                    "Request cancelled"
            }

            else -> {
                btnConnect.isEnabled = false
                btnConnect.alpha = 0.6f
                btnConnect.text =
                    "Connection unavailable"
            }
        }
    }

    private fun requestPin() {
        val link = currentLink ?: return

        if (
            !link.status.equals(
                "pending",
                ignoreCase = true
            )
        ) {
            return
        }

        val merchantName =
            link.merchant
                ?.name
                ?.trim()
                ?.takeIf {
                    it.isNotBlank()
                }
                ?: "this merchant"

        val intent =
            Intent(
                this,
                PinVerifyActivity::class.java
            ).apply {
                putExtra(
                    PinVerifyActivity.EXTRA_TITLE,
                    "Confirm Connection"
                )

                putExtra(
                    PinVerifyActivity.EXTRA_SUBTITLE,
                    "Authorize $merchantName to connect to your JeezPay account"
                )
            }

        pinLauncher.launch(intent)
    }

    private fun approveLink(
        pin: String
    ) {
        setPageLoading(true)

        lifecycleScope.launch {
            val result = withContext(
                Dispatchers.IO
            ) {
                safeApiCall {
                    ApiClient.accountLinkApi
                        .approveAccountLink(
                            accountLinkId,
                            ApproveAccountLinkRequest(
                                pin = pin
                            )
                        )
                }
            }

            when (result) {
                is ApiResult.Success -> {
                    setPageLoading(false)

                    val response =
                        result.data

                    if (
                        response.ok == true &&
                        response.accountLink
                            ?.status
                            ?.equals(
                                "approved",
                                ignoreCase = true
                            ) == true
                    ) {
                        currentLink =
                            response.accountLink

                        renderLink(
                            response.accountLink
                        )

                        showSuccess()
                    } else {
                        Toast.makeText(
                            this@AccountLinkActivity,
                            response.message
                                ?: "Could not approve this connection",
                            Toast.LENGTH_LONG
                        ).show()

                        loadLink()
                    }
                }

                is ApiResult.Error -> {
                    setPageLoading(false)

                    handleApprovalError(
                        result.error
                    )
                }
            }
        }
    }

    private fun showSuccess() {
        val merchantName =
            currentLink
                ?.merchant
                ?.name
                ?.trim()
                ?.takeIf {
                    it.isNotBlank()
                }
                ?: "The merchant"

        MaterialAlertDialogBuilder(this)
            .setTitle("Connection approved")
            .setMessage(
                "You approved $merchantName to connect to your JeezPay account. You can now return to the merchant app."
            )
            .setCancelable(false)
            .setPositiveButton(
                "Done"
            ) { _, _ ->
                finish()
            }
            .show()
    }

    private fun handleLoadError(
        error: AppError
    ) {
        handleCommonError(
            error = error,
            retryAction = {
                loadLink()
            },
            onValidation = {
                message ->
                Toast.makeText(
                    this,
                    message,
                    Toast.LENGTH_LONG
                ).show()

            },
            onUnauthorized = {
                reauthenticateWithPendingLink()
            }
        )
    }

    private fun handleApprovalError(
        error: AppError
    ) {
        handleCommonError(
            error = error,
            retryAction = {
                requestPin()
            },
            onValidation = {
                message ->
                Toast.makeText(
                    this,
                    message,
                    Toast.LENGTH_LONG
                ).show()

                loadLink()
            },
            onUnauthorized = {
                reauthenticateWithPendingLink()
            }
        )
    }

    private fun reauthenticateWithPendingLink() {
        getSharedPreferences(
            PREFS_NAME,
            MODE_PRIVATE
        )
            .edit()
            .putString(
                PREF_PENDING_ACCOUNT_LINK,
                accountLinkId
            )
            .remove(
                "pending_merchant_payment_id"
            )
            .apply()

        session.clearAll()

        startActivity(
            Intent(
                this,
                AuthActivity::class.java
            ).apply {
                flags =
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK

                putExtra(
                    AuthActivity.EXTRA_FORCE_LOGIN,
                    true
                )
            }
        )

        finish()
    }

    private fun setPageLoading(
        loading: Boolean
    ) {
        if (loading) {
            showBlockingLoader()
        } else {
            hideBlockingLoader()
        }

        btnNotNow.isEnabled =
            !loading

        if (loading) {
            btnConnect.isEnabled =
                false

            btnConnect.text =
                "Loading..."
        } else {
            currentLink?.let {
                renderLink(it)
            }
        }
    }
}
