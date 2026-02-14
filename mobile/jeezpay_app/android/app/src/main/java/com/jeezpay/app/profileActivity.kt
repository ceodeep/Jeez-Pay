package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.jeezpay.app.databinding.ActivityProfileBinding

class ProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProfileBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Back
        binding.btnBack.setOnClickListener { finish() }

        // Example: replace this with real value from API / local user session
        val isKycVerified = false

        if (!isKycVerified) {
            binding.kycCard.visibility = android.view.View.VISIBLE
            binding.btnStartKyc.setOnClickListener {
                startActivity(Intent(this, KycActivity::class.java))
            }
        } else {
            binding.kycCard.visibility = android.view.View.GONE
        }

        // Sections
        binding.rowProfile.setOnClickListener {
            // startActivity(Intent(this, EditProfileActivity::class.java))
        }

        binding.rowSecurity.setOnClickListener {
            // startActivity(Intent(this, SecuritySettingsActivity::class.java))
        }

        binding.rowPayments.setOnClickListener {
            // startActivity(Intent(this, PaymentSettingsActivity::class.java))
        }

        binding.rowAbout.setOnClickListener {
            // startActivity(Intent(this, AboutActivity::class.java))
        }

        // Logout inside profile
        binding.rowLogout.setOnClickListener {
            // TODO: clear token/session
            // Example:
            // sessionManager.clear()

            val i = Intent(this, AuthActivity::class.java)
            i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(i)
        }
    }
}
