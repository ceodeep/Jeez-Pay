package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.dto.ProductCapability
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DepositActivity : BaseFintechActivity() {

    private val productRepo = ProductRepository()

    private lateinit var btnBack: View
    private lateinit var rowUsdt: LinearLayout
    private lateinit var rowEgp: LinearLayout
    private lateinit var rowSdg: LinearLayout
    private lateinit var rowSsp: LinearLayout
    private lateinit var rowUgx: LinearLayout

    private var policyLoading = false
    private var policyReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_deposit)
        initBlockingLoader()

        btnBack = findViewById(R.id.btnBack)
        rowUsdt = findViewById(R.id.rowUsdt)
        rowEgp = findViewById(R.id.rowEgp)
        rowSdg = findViewById(R.id.rowSdg)
        rowSsp = findViewById(R.id.rowSsp)
        rowUgx = findViewById(R.id.rowUgx)

        btnBack.setOnClickListener { finish() }

        hideAllDepositRows()
        bindDepositActions()
        loadDepositPolicy()
    }

    private fun bindDepositActions() {
        rowUsdt.setOnClickListener {
            if (!isDepositAllowed("USDT")) {
                showUnavailable("USDT deposits are not available right now")
                return@setOnClickListener
            }

            startActivity(Intent(this, DepositUsdtActivity::class.java))
        }

        rowEgp.setOnClickListener {
            if (!isDepositAllowed("EGP")) return@setOnClickListener
            showComingSoon("EGP deposit via Vodafone Cash")
        }

        rowSdg.setOnClickListener {
            if (!isDepositAllowed("SDG")) return@setOnClickListener
            showComingSoon("SDG deposit via Bankak / local transfer")
        }

        rowSsp.setOnClickListener {
            if (!isDepositAllowed("SSP")) return@setOnClickListener
            showComingSoon("SSP deposit via local agent or bank transfer")
        }

        rowUgx.setOnClickListener {
            if (!isDepositAllowed("UGX")) return@setOnClickListener
            showComingSoon("UGX deposit via Mobile Money / local transfer")
        }
    }

    private fun loadDepositPolicy(forceRefresh: Boolean = false) {
        if (policyLoading) return

        val cached = ProductPolicyStore.current()
        if (!forceRefresh && cached != null) {
            applyDepositPolicy(cached)
            return
        }

        policyLoading = true
        policyReady = false
        hideAllDepositRows()
        showBlockingLoader()

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    policyLoading = false
                    ProductPolicyStore.replace(result.data)
                    applyDepositPolicy(result.data)
                }

                is ApiResult.Error -> {
                    policyLoading = false
                    policyReady = false
                    ProductPolicyStore.clear()
                    hideAllDepositRows()
                    hideBlockingLoader()
                    handleCommonError(
                        error = result.error,
                        retryAction = { loadDepositPolicy(forceRefresh = true) },
                        onValidation = { showUnavailable(it) }
                    )
                }
            }
        }
    }

    private fun applyDepositPolicy(config: ProductCapabilitiesResponse) {
        ProductPolicyStore.replace(config)

        val cashInCurrencies = ProductPolicyStore
            .currenciesWithCapability(ProductCapability.CASH_IN)
            .toSet()

        rowSsp.visibility = if ("SSP" in cashInCurrencies) View.VISIBLE else View.GONE
        rowSdg.visibility = if ("SDG" in cashInCurrencies) View.VISIBLE else View.GONE
        rowEgp.visibility = if ("EGP" in cashInCurrencies) View.VISIBLE else View.GONE
        rowUgx.visibility = if ("UGX" in cashInCurrencies) View.VISIBLE else View.GONE

        rowUsdt.visibility = if (
            ProductPolicyStore.isCapabilityEnabled("USDT", ProductCapability.USDT_RECEIVE)
        ) {
            View.VISIBLE
        } else {
            View.GONE
        }

        policyReady = listOf(rowUsdt, rowEgp, rowSdg, rowSsp, rowUgx)
            .any { it.visibility == View.VISIBLE }

        hideBlockingLoader()

        if (!policyReady) {
            showUnavailable("Deposits are not available right now")
        }
    }

    private fun isDepositAllowed(currency: String): Boolean {
        if (!policyReady) {
            showUnavailable("Deposit products are still loading")
            return false
        }

        val normalized = currency.trim().uppercase()
        val allowed = if (normalized == "USDT") {
            ProductPolicyStore.isCapabilityEnabled(
                normalized,
                ProductCapability.USDT_RECEIVE
            )
        } else {
            ProductPolicyStore.isCapabilityEnabled(
                normalized,
                ProductCapability.CASH_IN
            )
        }

        if (!allowed) {
            showUnavailable("Deposits in $normalized are not available right now")
        }

        return allowed
    }

    private fun hideAllDepositRows() {
        if (::rowUsdt.isInitialized) rowUsdt.visibility = View.GONE
        if (::rowEgp.isInitialized) rowEgp.visibility = View.GONE
        if (::rowSdg.isInitialized) rowSdg.visibility = View.GONE
        if (::rowSsp.isInitialized) rowSsp.visibility = View.GONE
        if (::rowUgx.isInitialized) rowUgx.visibility = View.GONE
    }

    private fun showComingSoon(method: String) {
        Toast.makeText(this, "$method coming soon", Toast.LENGTH_SHORT).show()
    }

    private fun showUnavailable(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
