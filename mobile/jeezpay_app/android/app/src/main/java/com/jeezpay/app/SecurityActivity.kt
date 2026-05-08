package com.jeezpay.app

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class SecurityActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_security)

        findViewById<TextView>(R.id.tvTitle).text = "Security"

        val container = findViewById<android.widget.LinearLayout>(R.id.contentContainer)

        container.addView(createItem("Change PIN", "Update your transaction PIN"))
        container.addView(createItem("Biometric Login", "Coming soon"))
    }

    private fun createItem(title: String, subtitle: String): android.view.View {
        val view = layoutInflater.inflate(R.layout.item_settings_row_profile, null)
        view.findViewById<TextView>(android.R.id.text1)?.text = title
        return view
    }
}
