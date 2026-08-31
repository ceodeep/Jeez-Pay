package com.jeezpay.app.repository

import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-local snapshots of the server-owned product configuration.
 *
 * Snapshots are keyed by country/product scope so a GLOBAL crypto lookup cannot
 * overwrite the South Sudan launch policy used by Home, Send, Deposit, and
 * Receive. This is intentionally not a durable cache: after an app restart,
 * money features must load fresh policy from the backend.
 */
object ProductPolicyStore {
    const val LAUNCH_COUNTRY_CODE = "SS"
    const val GLOBAL_COUNTRY_CODE = "GLOBAL"

    private val snapshots = ConcurrentHashMap<String, ProductCapabilitiesResponse>()

    private fun normalizeCountryCode(countryCode: String): String =
        countryCode.trim().uppercase().ifBlank { LAUNCH_COUNTRY_CODE }

    fun replace(config: ProductCapabilitiesResponse) {
        val key = normalizeCountryCode(config.countryCode)
        snapshots[key] = config
    }

    fun clear(countryCode: String? = null) {
        if (countryCode == null) {
            snapshots.clear()
            return
        }

        snapshots.remove(normalizeCountryCode(countryCode))
    }

    fun current(
        countryCode: String = LAUNCH_COUNTRY_CODE
    ): ProductCapabilitiesResponse? =
        snapshots[normalizeCountryCode(countryCode)]

    fun defaultCurrency(
        countryCode: String = LAUNCH_COUNTRY_CODE
    ): String? =
        current(countryCode)
            ?.defaultCurrency
            ?.trim()
            ?.uppercase()
            ?.takeIf { it.isNotBlank() }

    fun enabledCurrencies(
        countryCode: String = LAUNCH_COUNTRY_CODE
    ): List<String> =
        current(countryCode)
            ?.products
            ?.map { it.currency.trim().uppercase() }
            ?.filter { it.isNotBlank() }
            ?.distinct()
            ?: emptyList()

    fun currenciesWithCapability(
        capability: String,
        countryCode: String = LAUNCH_COUNTRY_CODE
    ): List<String> =
        current(countryCode)
            ?.products
            ?.filter { it.isCapabilityEnabled(capability) }
            ?.map { it.currency.trim().uppercase() }
            ?.filter { it.isNotBlank() }
            ?.distinct()
            ?: emptyList()

    fun isCurrencyEnabled(
        currency: String,
        countryCode: String = LAUNCH_COUNTRY_CODE
    ): Boolean =
        current(countryCode)
            ?.enabledCurrencies()
            ?.contains(currency.trim().uppercase()) == true

    fun isCapabilityEnabled(
        currency: String,
        capability: String,
        countryCode: String = LAUNCH_COUNTRY_CODE
    ): Boolean =
        current(countryCode)
            ?.isCapabilityEnabled(currency, capability) == true
}
