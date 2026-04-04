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

        findViewById<TextView>(R.id.tvTitle).text = "Profile"
        findViewById<TextView>(R.id.tvDetails).text =
            "Name: $fullName\n\nDOB: $dob\n\nAddress: $address"
    }
}