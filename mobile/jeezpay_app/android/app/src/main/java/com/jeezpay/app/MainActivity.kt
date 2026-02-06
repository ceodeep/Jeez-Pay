package com.jeezpay.app

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

class MainActivity : AppCompatActivity() {

    private val PREFS = "jeezpay_prefs"
    private val KEY_BALANCE_HIDDEN = "balance_hidden"

    private var balanceHidden = false
    private val balanceValue = "$ 1,250.00"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val actionText = findViewById<TextView>(R.id.actionText)

        // ===== Step 1: Balance show/hide =====
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        balanceHidden = prefs.getBoolean(KEY_BALANCE_HIDDEN, false)

        val tvBalance = findViewById<TextView>(R.id.tvBalance)
        val btnToggleBalance = findViewById<ImageView>(R.id.btnToggleBalance)

        fun renderBalance() {
            if (balanceHidden) {
                tvBalance.text = "••••••"
                btnToggleBalance.setImageResource(R.drawable.ic_eye_off)
            } else {
                tvBalance.text = balanceValue
                btnToggleBalance.setImageResource(R.drawable.ic_eye)
            }
        }

        btnToggleBalance.setOnClickListener {
            balanceHidden = !balanceHidden
            prefs.edit().putBoolean(KEY_BALANCE_HIDDEN, balanceHidden).apply()
            renderBalance()
        }
        renderBalance()

        // ===== Step 2: Quick actions grid (clicks) =====
        fun bindAction(id: Int, label: String) {
            findViewById<View>(id).setOnClickListener {
                actionText.visibility = View.VISIBLE
                actionText.text = "$label clicked"
            }
        }

        bindAction(R.id.btnDeposit, "Deposit")
        bindAction(R.id.btnSend, "Send")
        bindAction(R.id.btnEarn, "Earn")
        bindAction(R.id.btnP2P, "P2P")
        bindAction(R.id.btnReferral, "Referral")
        bindAction(R.id.btnCredit, "Credit")
        bindAction(R.id.btnSwap, "Swap")
        bindAction(R.id.btnMore, "More")

        // ===== Step 3: Transactions RecyclerView =====
        val rv = findViewById<RecyclerView>(R.id.rvTransactions)
        rv.layoutManager = LinearLayoutManager(this)

        val tx = listOf(
            TransactionItem("Starlink", "•• 5719", "2026-02-02 10:14:52", "-30.00 USD", "Declined"),
            TransactionItem("Starlink", "•• 5719", "2026-02-02 09:52:33", "-50.00 USD", "Declined"),
            TransactionItem("Netflix", "•• 1284", "2026-02-01 22:01:10", "-12.99 USD", "Completed")
        )

        rv.adapter = TransactionsAdapter(tx)

        // ===== Step 4: Bottom nav screen switching + selection UI =====
        val flipper = findViewById<View>(R.id.screenFlipper) as android.widget.ViewFlipper

        val navHome = findViewById<View>(R.id.navHome)
        val navCard = findViewById<View>(R.id.navCard)
        val navSend = findViewById<View>(R.id.navSend)
        val navHub = findViewById<View>(R.id.navHub)

        val iconHome = findViewById<ImageView>(R.id.iconHome)
        val iconCard = findViewById<ImageView>(R.id.iconCard)
        val iconSend = findViewById<ImageView>(R.id.iconSend)
        val iconHub = findViewById<ImageView>(R.id.iconHub)

        val textHome = findViewById<TextView>(R.id.textHome)
        val textCard = findViewById<TextView>(R.id.textCard)
        val textSend = findViewById<TextView>(R.id.textSend)
        val textHub = findViewById<TextView>(R.id.textHub)

        val active = ContextCompat.getColor(this, R.color.paypal_blue)
        val inactive = ContextCompat.getColor(this, R.color.text_tertiary)

        fun resetTab(container: View, icon: ImageView, label: TextView) {
            container.setBackgroundColor(Color.TRANSPARENT)
            icon.setColorFilter(inactive)
            label.setTextColor(inactive)
        }

        fun selectTab(container: View, icon: ImageView, label: TextView) {
            container.setBackgroundResource(R.drawable.bottom_nav_selected_pill)
            icon.setColorFilter(active)
            label.setTextColor(active)
        }

        fun setSelected(index: Int) {
            resetTab(navHome, iconHome, textHome)
            resetTab(navCard, iconCard, textCard)
            resetTab(navSend, iconSend, textSend)
            resetTab(navHub, iconHub, textHub)

            when (index) {
                0 -> selectTab(navHome, iconHome, textHome)
                1 -> selectTab(navCard, iconCard, textCard)
                2 -> selectTab(navSend, iconSend, textSend)
                3 -> selectTab(navHub, iconHub, textHub)
            }

            flipper.displayedChild = index
        }

        navHome.setOnClickListener { setSelected(0) }
        navCard.setOnClickListener { setSelected(1) }
        navSend.setOnClickListener { setSelected(2) }
        navHub.setOnClickListener { setSelected(3) }

        // default
        setSelected(0)
    }
}
