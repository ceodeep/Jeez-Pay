package com.jeezpay.app

import android.os.Bundle
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class ProfileDetailsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_simple_page)

        val fullName = intent.getStringExtra("fullName").orEmpty()
        val dob = intent.getStringExtra("dob").orEmpty()
        val address = intent.getStringExtra("address").orEmpty()

        findViewById<ImageView>(R.id.btnBack).setOnClickListener {
            finish()
        }

        findViewById<TextView>(R.id.tvTitle).text =
            if (fullName.isBlank()) "Profile" else fullName

        findViewById<TextView>(R.id.tvSubtitle).text = "Your verified profile information"

        findViewById<TextView>(R.id.tvAvatarLetter).text =
            fullName.firstOrNull()?.uppercase() ?: "J"

        findViewById<TextView>(R.id.tvValueName).text =
            if (fullName.isBlank()) "-" else fullName

        findViewById<TextView>(R.id.tvValueDob).text =
            if (dob.isBlank()) "-" else dob

        findViewById<TextView>(R.id.tvValueAddress).text =
            if (address.isBlank()) "-" else address
    }
}