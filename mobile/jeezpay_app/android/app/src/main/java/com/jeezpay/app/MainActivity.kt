package com.jeezpay.app
import androidx.recyclerview.widget.LinearLayoutManager
import com.jeezpay.app.adapters.WalletStripAdapter
import android.content.Intent

import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.jeezpay.app.adapters.WalletPickerAdapter
import java.text.NumberFormat
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private val prefs by lazy { getSharedPreferences("jeezpay_prefs", MODE_PRIVATE) }

    private lateinit var screenFlipper: android.widget.ViewFlipper

    // top/balance UI
    private lateinit var tvBalance: TextView
    private lateinit var btnToggleBalance: ImageView

    // currency pill UI
    private lateinit var btnCurrency: LinearLayout
    private lateinit var imgCurrency: ImageView
    private lateinit var tvCurrency: TextView

    // action status
    private lateinit var actionText: TextView

    // custom bottom nav items
    private lateinit var navHome: LinearLayout
    private lateinit var navCard: LinearLayout
    private lateinit var navSend: LinearLayout
    private lateinit var navHub: LinearLayout

    private lateinit var iconHome: ImageView
    private lateinit var iconCard: ImageView
    private lateinit var iconSend: ImageView
    private lateinit var iconHub: ImageView

    private lateinit var textHome: TextView
    private lateinit var textCard: TextView
    private lateinit var textSend: TextView
    private lateinit var textHub: TextView

    // wallets
    private fun setupWalletStrip() {
        rvWalletStrip.layoutManager =
            LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)

        walletStripAdapter = WalletStripAdapter(wallets, selectedCode) { picked ->
            selectedCode = picked.code
            prefs.edit().putString("selected_wallet", selectedCode).apply()
            applySelectedWallet(selectedCode)
            walletStripAdapter?.setSelected(selectedCode)
        }

        rvWalletStrip.adapter = walletStripAdapter
    }

    private lateinit var rvWalletStrip: RecyclerView
    private var walletStripAdapter: WalletStripAdapter? = null

    private lateinit var wallets: MutableList<WalletBalance>
    private var selectedCode: String = "USDT"
    private var isBalanceHidden: Boolean = false

    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val tvLogout = findViewById<TextView>(R.id.tvLogout)

        tvLogout.setOnClickListener {
            val prefs = getSharedPreferences("jeezpay_prefs", MODE_PRIVATE)

            // Only log out session (keep PIN saved for demo convenience)
            prefs.edit()
                .putBoolean("logged_in", false)
                .apply()

            startActivity(Intent(this, AuthActivity::class.java))
            finish()
        }


        bindViews()
        setupWallets()
        setupCurrencyPill()
        setupBalanceToggle()
        setupActionButtons()
        setupCustomBottomNav()
    }

    private fun bindViews() {
        screenFlipper = findViewById(R.id.screenFlipper)

        tvBalance = findViewById(R.id.tvBalance)
        btnToggleBalance = findViewById(R.id.btnToggleBalance)

        btnCurrency = findViewById(R.id.btnCurrency)
        imgCurrency = findViewById(R.id.imgCurrency)
        tvCurrency = findViewById(R.id.tvCurrency)

        actionText = findViewById(R.id.actionText)

        navHome = findViewById(R.id.navHome)
        navCard = findViewById(R.id.navCard)
        navSend = findViewById(R.id.navSend)
        navHub = findViewById(R.id.navHub)

        iconHome = findViewById(R.id.iconHome)
        iconCard = findViewById(R.id.iconCard)
        iconSend = findViewById(R.id.iconSend)
        iconHub = findViewById(R.id.iconHub)

        textHome = findViewById(R.id.textHome)
        textCard = findViewById(R.id.textCard)
        textSend = findViewById(R.id.textSend)
        textHub = findViewById(R.id.textHub)
        rvWalletStrip = findViewById(R.id.rvWalletStrip)

    }

    private fun setupWallets() {


        // load saved state
        selectedCode = prefs.getString("selected_wallet", "USDT") ?: "USDT"
        isBalanceHidden = prefs.getBoolean("hide_balance", false)

        // IMPORTANT:
        // Replace/adjust icons you actually have in drawable.
        // If you don't have flags yet, keep logo_usdt for all for now.
        wallets = mutableListOf(
            WalletBalance("USDT", "Tether", R.drawable.logo_usdt, 1250.00),
            WalletBalance("SSP", "South Sudan Pound", R.drawable.flag_ssp, 0.00),
            WalletBalance("SDG", "Sudanese Pound", R.drawable.flag_sdg, 0.00),
            WalletBalance("EGP", "Egyptian Pound", R.drawable.flag_egp, 0.00),
            WalletBalance("UGX", "Ugandan Shilling", R.drawable.flag_ugx, 0.00)
        )

        applySelectedWallet(selectedCode)
        applyBalanceVisibility()
        setupWalletStrip()
    }

    private fun setupCurrencyPill() {
        btnCurrency.setOnClickListener {
            showWalletPicker { picked ->
                selectedCode = picked.code
                prefs.edit().putString("selected_wallet", selectedCode).apply()
                applySelectedWallet(selectedCode)
            }
        }
    }

    private fun setupBalanceToggle() {
        btnToggleBalance.setOnClickListener {
            isBalanceHidden = !isBalanceHidden
            prefs.edit().putBoolean("hide_balance", isBalanceHidden).apply()
            applyBalanceVisibility()
        }
    }

    private fun setupActionButtons() {
        val btnSend = findViewById<View>(R.id.btnSend)

        // If you still have btnReceive/btnHistory in this new grid, add them.
        // In your current file, only btnSend exists from the old ones.
        btnSend.setOnClickListener {
            actionText.text = "Send clicked"
            actionText.visibility = View.VISIBLE
        }
    }

    private fun setupCustomBottomNav() {
        // Default screen: Home (index 0)
        selectTab(0)

        navHome.setOnClickListener { selectTab(0) }
        navCard.setOnClickListener { selectTab(1) }
        navSend.setOnClickListener { selectTab(2) }
        navHub.setOnClickListener { selectTab(3) }
    }

    private fun selectTab(index: Int) {
        screenFlipper.displayedChild = index

        // selected background only for home in your drawable style,
        // but we will apply it dynamically:
        setTabSelected(navHome, iconHome, textHome, index == 0)
        setTabSelected(navCard, iconCard, textCard, index == 1)
        setTabSelected(navSend, iconSend, textSend, index == 2)
        setTabSelected(navHub, iconHub, textHub, index == 3)
    }

    private fun setTabSelected(container: LinearLayout, icon: ImageView, label: TextView, selected: Boolean) {
        if (selected) {
            container.setBackgroundResource(R.drawable.bottom_nav_selected_pill)
            icon.setColorFilter(getColor(R.color.paypal_blue))
            label.setTextColor(getColor(R.color.paypal_blue))
        } else {
            container.background = null
            icon.setColorFilter(getColor(R.color.text_tertiary))
            label.setTextColor(getColor(R.color.text_tertiary))
        }
    }

    private fun applySelectedWallet(code: String) {
        val w = wallets.firstOrNull { it.code == code } ?: wallets.first()

        imgCurrency.setImageResource(w.iconRes)
        tvCurrency.text = w.code

        // update balance text based on hidden state
        applyBalanceVisibility()
        walletStripAdapter?.setSelected(code)

    }

    private fun applyBalanceVisibility() {
        val w = wallets.firstOrNull { it.code == selectedCode } ?: wallets.first()

        if (isBalanceHidden) {
            tvBalance.text = "••••••"
            btnToggleBalance.setImageResource(R.drawable.ic_eye_off)
        } else {
            tvBalance.text = "${nf.format(w.amount)} ${w.code}"
            btnToggleBalance.setImageResource(R.drawable.ic_eye)
        }
    }

    private fun showWalletPicker(onPicked: (WalletBalance) -> Unit) {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_wallets, null)

        val rv = view.findViewById<RecyclerView>(R.id.rvWallets)
        rv.layoutManager = LinearLayoutManager(this)
        rv.adapter = WalletPickerAdapter(wallets) { picked ->
            dialog.dismiss()
            onPicked(picked)
        }

        dialog.setContentView(view)
        dialog.show()
    }
}
