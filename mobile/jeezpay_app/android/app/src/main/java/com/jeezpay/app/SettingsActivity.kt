package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private fun openComingSoon(title: String) {
        Toast.makeText(this, "$title coming soon", Toast.LENGTH_SHORT).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }

        findViewById<android.view.View>(R.id.rowProfile).setOnClickListener {
            startActivity(Intent(this, ProfileDetailsActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowKyc).setOnClickListener {
            startActivity(Intent(this, KycActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowSecurity).setOnClickListener {
            startActivity(Intent(this, SecurityActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowChangePin).setOnClickListener {
            startActivity(Intent(this, ChangePinActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowPaymentSettings).setOnClickListener {
            startActivity(Intent(this, PaymentSettingsActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowLimits).setOnClickListener {
            startActivity(Intent(this, LimitsActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowReferral).setOnClickListener {
            startActivity(Intent(this, ReferralActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowAbout).setOnClickListener {
            startActivity(Intent(this, AboutActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowPrivacy).setOnClickListener {
            startActivity(Intent(this, PrivacyActivity::class.java))
        }

        findViewById<android.view.View>(R.id.rowTerms).setOnClickListener {
            startActivity(Intent(this, TermsActivity::class.java))
        }
    }
}