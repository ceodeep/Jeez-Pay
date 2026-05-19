package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import com.jeezpay.app.base.BaseFintechActivity

class ServicesActivity : BaseFintechActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_services)

        findViewById<View>(R.id.btnBack).setOnClickListener {
            finish()
        }

        findViewById<View>(R.id.cardStarlink).setOnClickListener {
            openRequest(
                serviceType = "starlink",
                title = "Starlink Subscription",
                providerHint = "Starlink",
                referenceHint = "Kit number / account number"
            )
        }

        findViewById<View>(R.id.cardTelecom).setOnClickListener {
            openRequest(
                serviceType = "telecom",
                title = "Telecom Subscription",
                providerHint = "Zain / MTN / Sudani",
                referenceHint = "Phone number"
            )
        }

        findViewById<View>(R.id.cardElectricity).setOnClickListener {
            openRequest(
                serviceType = "electricity",
                title = "Electricity Payment",
                providerHint = "Electricity provider",
                referenceHint = "Meter number"
            )
        }

        findViewById<View>(R.id.cardInternet).setOnClickListener {
            openRequest(
                serviceType = "internet",
                title = "Internet Package",
                providerHint = "Internet provider",
                referenceHint = "Account / phone number"
            )
        }

        findViewById<TextView>(R.id.btnMyServiceRequests).setOnClickListener {
            startActivity(Intent(this, ServiceRequestsActivity::class.java))
        }
    }

    private fun openRequest(
        serviceType: String,
        title: String,
        providerHint: String,
        referenceHint: String
    ) {
        val i = Intent(this, ServiceRequestActivity::class.java).apply {
            putExtra("serviceType", serviceType)
            putExtra("title", title)
            putExtra("providerHint", providerHint)
            putExtra("referenceHint", referenceHint)
        }
        startActivity(i)
    }
}