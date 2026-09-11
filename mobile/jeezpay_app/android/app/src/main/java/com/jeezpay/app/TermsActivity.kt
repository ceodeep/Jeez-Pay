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
        findViewById<TextView>(R.id.tvInfoSubtitle).text =
            "Terms for using JeezPay's SSP wallet and payment services."

        findViewById<TextView>(R.id.tvContent).text = """
Last updated: September 11, 2026

Welcome to JeezPay. By creating an account or using JeezPay, you agree to these Terms & Conditions.

1. Account Registration
You must provide accurate, complete, and current information when creating or maintaining your JeezPay account.

You are responsible for protecting your account credentials, password, transaction PIN, device access, and other authentication information.

You must not allow another person to use your JeezPay account in a way that violates these Terms or applicable law.

2. JeezPay Services
JeezPay provides digital wallet and payment services for supported products.

For the current South Sudan launch, the supported wallet currency is the South Sudanese Pound (SSP).

Depending on service availability and your account eligibility, JeezPay may allow you to hold an SSP balance, send and receive money, make merchant payments, and use approved cash-in or cash-out services.

A service is available only when JeezPay makes it available to your account through the app or another authorized JeezPay channel.

3. Transactions
You are responsible for reviewing the recipient, merchant, amount, currency, fee, and other transaction details before confirming a transaction.

Once a transaction has been successfully processed, it may not be reversible. A correction, reversal, refund, or adjustment may be made only when permitted by JeezPay's systems, applicable rules, the relevant transaction type, or applicable law.

Do not send money to a person, merchant, or account unless you have verified that the transaction details are correct.

4. Cash-In and Cash-Out
Cash-in or cash-out services may be available through approved JeezPay agents, merchants, financial partners, or other methods specifically presented by JeezPay.

Availability, operating hours, fees, transaction limits, identity requirements, and processing times may vary.

You should use only channels identified or approved by JeezPay for these services.

5. Fees and Transaction Limits
JeezPay may apply transaction fees, minimum transaction amounts, maximum transaction amounts, account limits, security controls, or other service limits.

Where applicable, relevant transaction information should be displayed or enforced before a transaction is completed.

Limits and fees may differ by service, account status, verification status, risk controls, or operational requirements and may be updated from time to time.

6. PIN and Account Security
Sensitive JeezPay actions may require a transaction PIN, biometric confirmation, password, or other security check.

Biometric confirmation, where supported, is a device security mechanism and does not remove JeezPay's transaction authorization or security requirements.

Never share your password, PIN, authentication codes, or account access with another person.

7. Identity Verification and Compliance
JeezPay may require identity verification or additional information before enabling or continuing certain services.

JeezPay may delay, reject, review, restrict, or suspend transactions or accounts when necessary for identity verification, fraud prevention, security, risk management, legal requirements, compliance controls, or investigation of suspicious activity.

8. Prohibited Use
You must not use JeezPay for fraud, scams, theft, money laundering, terrorism financing, sanctions evasion, illegal gambling, unauthorized financial activity, unlawful goods or services, abuse of another person's account, or any activity prohibited by applicable law.

You must not attempt to bypass transaction limits, security controls, identity checks, account restrictions, or other JeezPay safeguards.

9. Merchants and Agents
JeezPay may support transactions involving approved merchants or agents.

A merchant or agent may have its own operating procedures, service availability, or lawful requirements. JeezPay may restrict or suspend a merchant, agent, or transaction when required for security, risk, compliance, or operational reasons.

10. Account Restrictions
JeezPay may temporarily or permanently restrict access to an account or service because of suspected fraud, unauthorized access, false or incomplete information, security risks, prohibited activity, legal requirements, compliance obligations, abuse of the platform, or other serious violations of these Terms.

Where appropriate, JeezPay may request additional information before restoring access.

11. Service Availability
JeezPay services may occasionally be unavailable because of maintenance, telecommunications or internet failures, infrastructure issues, third-party service interruptions, security incidents, operational restrictions, or circumstances outside JeezPay's reasonable control.

JeezPay does not guarantee uninterrupted availability of every service.

12. Responsibility and Liability
To the extent permitted by applicable law, JeezPay is not responsible for losses caused by incorrect transaction information entered or approved by the user, unauthorized access resulting from compromised user credentials or devices, misuse of an account, third-party outages, or events outside JeezPay's reasonable control.

Nothing in these Terms excludes responsibility that cannot lawfully be excluded.

13. Changes to Services or Terms
JeezPay may update, add, restrict, or discontinue services and may update these Terms when necessary.

The latest Terms will be made available through JeezPay with their effective or last-updated date.

14. Contact
For questions about your account, transactions, or these Terms, contact JeezPay through the official support channels provided by JeezPay.
        """.trimIndent()

        findViewById<View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}