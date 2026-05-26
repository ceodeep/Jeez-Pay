package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class TermsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_info_page)

        findViewById<TextView>(R.id.tvTitle).text = "Terms & Conditions"

        findViewById<TextView>(R.id.tvContent).text = """
Last updated: May 2026

Welcome to JeezPay. By creating an account or using JeezPay services, you agree to these Terms & Conditions.

1. Account Registration
You must provide accurate and complete information when creating your account. You are responsible for keeping your phone number, password, PIN, and account access secure.

2. Wallet Services
JeezPay allows users to hold supported wallet balances, send money, receive money, swap supported currencies, deposit supported digital assets, and request bill or service payments where available.

3. USDT Deposits
USDT deposits are currently supported only through the TRON/TRC20 network. You must send only USDT TRC20 to the deposit address shown in the app. Sending unsupported tokens, wrong networks, or other assets may result in permanent loss.

Minimum credited USDT deposit: 10 USDT. Deposits below the minimum may not be credited automatically and may require manual review.

4. Network Fees
Blockchain/network fees are paid by the sender or the relevant network participant. JeezPay does not receive TRON network fees charged by external wallets or blockchain networks.

5. Transactions
You are responsible for reviewing all transaction details before confirming. Completed wallet transfers, swaps, deposits, and service requests may not be reversible, except where JeezPay support can process a correction or refund according to internal rules.

6. PIN and Security
Your PIN is used to protect sensitive actions. Do not share your PIN, password, OTP, or account access with anyone. JeezPay will not be responsible for losses caused by user negligence, shared credentials, or unauthorized access resulting from poor account security.

7. KYC and Compliance
JeezPay may require identity verification before allowing certain services. We may reject, limit, suspend, or close accounts if information is false, incomplete, suspicious, or required by law, compliance rules, or risk controls.

8. Prohibited Use
You may not use JeezPay for fraud, scams, money laundering, terrorism financing, illegal gambling, unauthorized financial activity, stolen funds, sanctions evasion, or any activity prohibited by law.

9. Bills & Services
Bills and service payments may be processed manually or through third-party providers. Some requests may take time to complete. JeezPay may reject and refund a request if it cannot be fulfilled.

10. Fees and Limits
JeezPay may apply fees, exchange rates, minimum amounts, maximum limits, and service charges. Applicable fees or rates should be shown before confirmation where possible.

11. Account Suspension
JeezPay may temporarily or permanently restrict accounts for suspicious activity, policy violations, security risks, legal requirements, chargeback risk, or abuse of the platform.

12. Availability
JeezPay services may be interrupted due to maintenance, network issues, provider downtime, blockchain congestion, security incidents, or circumstances beyond our control.

13. Limitation of Liability
JeezPay is not responsible for losses caused by incorrect information entered by the user, wrong wallet networks, third-party provider failures, network delays, unauthorized account access, or events outside JeezPay’s reasonable control.

14. Updates to Terms
JeezPay may update these Terms & Conditions from time to time. Continued use of the app means you accept the updated terms.

15. Contact
For support, contact JeezPay through the official support channels provided in the app.
        """.trimIndent()

        findViewById<View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}