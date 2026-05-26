package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class PrivacyActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_info_page)

        findViewById<TextView>(R.id.tvTitle).text = "Privacy Policy"
        findViewById<TextView>(R.id.tvInfoSubtitle).text =
            "How JeezPay collects, protects, and uses your information."

        findViewById<TextView>(R.id.tvContent).text = """
Last updated: May 2026

JeezPay respects your privacy. This Privacy Policy explains what information we collect, how we use it, and how we protect it.

1. Information We Collect
We may collect your name, phone number, account type, country code, referral code, login details, wallet activity, transaction history, service requests, device information, and KYC information where required.

2. KYC and Identity Data
When identity verification is required, JeezPay may collect documents, images, personal details, and verification status. This information is used for compliance, fraud prevention, and account security.

3. Wallet and Transaction Data
We collect wallet balances, deposits, transfers, swaps, service payments, transaction references, blockchain deposit records, and related activity needed to operate JeezPay services.

4. How We Use Your Information
Your information is used to create and secure your account, process transactions, verify identity, prevent fraud, provide support, manage service requests, improve the app, and comply with legal or regulatory obligations.

5. Security
We use reasonable technical and organizational safeguards, including access controls, secure backend systems, encrypted connections where available, and restricted admin permissions. You are responsible for protecting your password, PIN, OTPs, and device access.

6. Data Sharing
JeezPay does not sell your personal information. We may share information with service providers, compliance partners, payment or telecom providers, blockchain infrastructure providers, fraud prevention tools, or authorities when required by law or necessary to provide services.

7. Blockchain Transactions
Blockchain transactions may be publicly visible on the relevant blockchain network. JeezPay cannot remove or alter blockchain records once they are confirmed.

8. Data Retention
We keep information for as long as needed to provide services, comply with legal obligations, resolve disputes, prevent fraud, and maintain accurate financial records.

9. Account Security
If you believe your account, password, PIN, or device has been compromised, contact JeezPay support immediately and change your credentials where possible.

10. User Rights
Depending on applicable laws, you may request correction, review, or deletion of certain personal information. Some records may need to be retained for compliance, security, or financial reporting.

11. Children
JeezPay is not intended for children or users who are not legally permitted to use financial services in their jurisdiction.

12. Updates to This Policy
We may update this Privacy Policy from time to time. Continued use of JeezPay means you accept the updated policy.

13. Contact
For privacy or support questions, contact JeezPay through the official support channels provided in the app.
        """.trimIndent()

        findViewById<View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}