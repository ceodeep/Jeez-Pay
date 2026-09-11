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
            "How JeezPay collects, uses, and protects your information."

        findViewById<TextView>(R.id.tvContent).text = """
Last updated: September 11, 2026

JeezPay respects your privacy. This Privacy Policy explains how information is collected, used, shared, and protected when you use JeezPay.

1. Information We Collect
We may collect information you provide when creating or using your account, including your name, phone number, email address, account details, login information, and other information you submit to JeezPay.

We may also collect information about your use of the service, including SSP wallet balances, transfers, merchant payments, cash-in or cash-out activity where available, transaction references, timestamps, device information, security events, and support communications.

2. Identity Verification
JeezPay may require identity verification before certain financial services can be used.

Where verification is required, we may collect identity information, identification documents, document images, a selfie or portrait image, verification results, and related information needed to confirm identity, protect accounts, prevent fraud, and meet legal or compliance requirements.

3. Wallet and Transaction Information
JeezPay records information required to operate your SSP wallet and process transactions. This may include transaction amounts, sender and recipient information, merchant or agent information where applicable, fees, references, transaction status, and account balances.

Financial transaction records may be retained even after an account is closed when required for security, accounting, dispute resolution, fraud prevention, or legal and compliance purposes.

4. How We Use Information
We may use your information to:

• create and manage your JeezPay account;
• provide SSP wallet and payment services;
• process and record transfers and payments;
• provide cash-in or cash-out services where available;
• verify identity and account eligibility;
• protect accounts and confirm sensitive actions;
• detect, investigate, and prevent fraud or misuse;
• enforce transaction, security, and compliance controls;
• provide customer support;
• maintain and improve JeezPay; and
• comply with applicable legal and regulatory obligations.

5. Security
JeezPay uses technical and organizational safeguards designed to protect account and transaction information. These may include access controls, secure network connections, authentication controls, transaction PIN protection, restricted administrative access, monitoring, and other security measures.

No system can guarantee absolute security. You are responsible for protecting your password, PIN, device access, and any authentication information associated with your account.

6. Sharing of Information
JeezPay does not sell your personal information.

Information may be shared when reasonably necessary with service providers that support JeezPay operations, identity verification, fraud prevention, payment processing, communications, infrastructure, security, or customer support.

Information may also be disclosed when required by applicable law, a lawful request, legal process, regulatory obligation, fraud investigation, security requirement, or to protect JeezPay, its users, or others from harm.

7. Agents and Merchants
When you use JeezPay with an authorized merchant or agent, information necessary to complete, verify, reconcile, or support that transaction may be shared with the relevant merchant or agent.

They should receive only information reasonably necessary for the relevant JeezPay service or transaction.

8. Data Retention
JeezPay retains information for as long as reasonably necessary to provide services, maintain financial and security records, resolve disputes, prevent fraud, enforce agreements, and satisfy legal, accounting, or compliance obligations.

Different categories of information may be retained for different periods.

9. Account and Device Security
If you believe your account, password, PIN, phone, or device has been compromised, contact JeezPay support as soon as possible and change your credentials where available.

JeezPay may temporarily restrict an account or transaction when necessary to investigate suspicious or potentially unauthorized activity.

10. Your Information
Subject to applicable law and record-retention requirements, you may request access to or correction of certain personal information associated with your JeezPay account.

Some financial, security, compliance, fraud-prevention, or transaction records may need to be retained even when other account information can be changed or deleted.

11. Children
JeezPay is intended only for people legally permitted to open and use a financial-services account. JeezPay is not intended for children who are not legally eligible to use the service.

12. Changes to This Policy
JeezPay may update this Privacy Policy when its services, legal obligations, security practices, or data-processing activities change.

The latest version will be made available through JeezPay with its effective or last-updated date.

13. Contact
For privacy, account, or support questions, contact JeezPay through the official support channels provided by JeezPay.
        """.trimIndent()

        findViewById<View>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }
}