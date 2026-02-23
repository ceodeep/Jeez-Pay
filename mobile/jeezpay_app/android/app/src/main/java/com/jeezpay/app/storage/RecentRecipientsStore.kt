package com.jeezpay.app.storage

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class RecentRecipient(
    val identifier: String,   // phone or wallet_account_number
    val displayName: String? = null
)

class RecentRecipientsStore(context: Context) {

    private val prefs = context.getSharedPreferences("jeezpay_recent", Context.MODE_PRIVATE)

    fun list(max: Int = 10): List<RecentRecipient> {
        val raw = prefs.getString(KEY_LIST, "[]") ?: "[]"
        val arr = JSONArray(raw)
        val out = mutableListOf<RecentRecipient>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                RecentRecipient(
                    identifier = o.optString("identifier", ""),
                    displayName = o.optString("displayName", null)
                )
            )
        }
        return out.filter { it.identifier.isNotBlank() }.take(max)
    }

    fun add(identifierRaw: String, displayName: String? = null, max: Int = 10) {
        val identifier = identifierRaw.trim()
        if (identifier.isBlank()) return

        val current = list(50).toMutableList()

        // remove duplicates (same identifier)
        current.removeAll { it.identifier.equals(identifier, ignoreCase = true) }

        // add on top
        current.add(0, RecentRecipient(identifier = identifier, displayName = displayName))

        // keep max
        val trimmed = current.take(max)

        val arr = JSONArray()
        trimmed.forEach {
            val o = JSONObject()
            o.put("identifier", it.identifier)
            o.put("displayName", it.displayName)
            arr.put(o)
        }

        prefs.edit().putString(KEY_LIST, arr.toString()).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_LIST).apply()
    }

    companion object {
        private const val KEY_LIST = "recent_list"
    }
}