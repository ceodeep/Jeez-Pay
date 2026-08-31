package com.jeezpay.app.network.dto

/**
 * Server-owned launch/product configuration returned by GET /products/capabilities.
 *
 * The Android client must use this data to decide which products and actions to
 * expose. The backend still performs the authoritative financial enforcement.
 */
data class ProductCapabilitiesResponse(
    val countryCode: String = "",
    val defaultCurrency: String? = null,
    val products: List<ProductCapabilityProductDto> = emptyList()
) {
    fun enabledCurrencies(): Set<String> =
        products.map { it.currency.trim().uppercase() }.filter { it.isNotBlank() }.toSet()

    fun product(currency: String): ProductCapabilityProductDto? {
        val normalized = currency.trim().uppercase()
        return products.firstOrNull { it.currency.trim().uppercase() == normalized }
    }

    fun isCapabilityEnabled(currency: String, capability: String): Boolean =
        product(currency)?.isCapabilityEnabled(capability) == true
}

data class ProductCapabilityProductDto(
    val currency: String = "",
    val displayName: String = "",
    val isDefault: Boolean = false,
    val capabilities: Map<String, Boolean> = emptyMap()
) {
    fun isCapabilityEnabled(capability: String): Boolean =
        capabilities[capability.trim().uppercase()] == true
}

object ProductCapability {
    const val FIAT_HOLD = "FIAT_HOLD"
    const val P2P_TRANSFER = "P2P_TRANSFER"
    const val CASH_IN = "CASH_IN"
    const val CASH_OUT = "CASH_OUT"
    const val MERCHANT_PAYMENT = "MERCHANT_PAYMENT"
    const val CROSS_BORDER_SEND = "CROSS_BORDER_SEND"
    const val CROSS_BORDER_RECEIVE = "CROSS_BORDER_RECEIVE"
    const val FX_CONVERT = "FX_CONVERT"
    const val USDT_HOLD = "USDT_HOLD"
    const val USDT_SEND = "USDT_SEND"
    const val USDT_RECEIVE = "USDT_RECEIVE"
    const val USDT_BUY = "USDT_BUY"
    const val USDT_SELL = "USDT_SELL"
}
