package com.jeezpay.app.repository

import com.jeezpay.app.network.dto.ProductCapabilitiesResponse

/**
 * Process-local snapshot of the server-owned product configuration.
 *
 * This is intentionally not a durable cache: after an app restart, money
 * features must load a fresh policy from the backend instead of trusting stale
 * capability data.
 */
object ProductPolicyStore {
    const val LAUNCH_COUNTRY_CODE = "SS"

    @Volatile
    private var snapshot: ProductCapabilitiesResponse? = null

    fun replace(config: ProductCapabilitiesResponse) {
        snapshot = config
    }

    fun clear() {
        snapshot = null
    }

    fun current(): ProductCapabilitiesResponse? = snapshot

    fun defaultCurrency(): String? =
        snapshot?.defaultCurrency?.trim()?.uppercase()?.takeIf { it.isNotBlank() }

    fun isCurrencyEnabled(currency: String): Boolean =
        snapshot?.enabledCurrencies()?.contains(currency.trim().uppercase()) == true

    fun isCapabilityEnabled(currency: String, capability: String): Boolean =
        snapshot?.isCapabilityEnabled(currency, capability) == true
}
