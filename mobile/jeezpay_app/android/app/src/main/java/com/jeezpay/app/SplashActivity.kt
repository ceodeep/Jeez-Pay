package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.postDelayed({
            startActivity(Intent(this, AuthActivity::class.java))
            finish()
        }, 900)
    }
}