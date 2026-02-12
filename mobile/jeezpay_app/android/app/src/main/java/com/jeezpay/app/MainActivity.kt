package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.jeezpay.app.adapters.TransactionsAdapter
import com.jeezpay.app.adapters.WalletPickerAdapter
import com.jeezpay.app.adapters.WalletStripAdapter
import com.jeezpay.app.repository.WalletRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout



class MainActivity : AppCompatActivity() {
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout

    private val walletRepo = WalletRepository()

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
    private fun showStatus(msg: String) {
        actionText.text = msg
        actionText.visibility = android.view.View.VISIBLE
    }

    private fun hideStatus() {
        actionText.text = ""
        actionText.visibility = android.view.View.GONE
    }

    private fun setBalanceLoading() {
        if (isBalanceHidden) {
            tvBalance.text = "••••••"
        } else {
            tvBalance.text = "Loading..."
        }
    }

    private fun formatAmount(amount: Double, code: String): String {
        // You already have nf in your file, so use it
        return "${nf.format(amount)} $code"
    }

    private fun fetchBalance(currency: String) {
        setBalanceLoading()

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = walletRepo.fetchBalance(currency)

                withContext(Dispatchers.Main) {
                    val w = wallets.firstOrNull { it.code == currency }
                    if (w != null) {
                        w.amount = res.balance
                    }

                    // show balance for the selected wallet
                    applyBalanceVisibility()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    showStatus("Balance failed: ${e.message}")
                }
            }
        }
    }

    private fun fetchHistory(currency: String) {
        showStatus("Loading transactions...")

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = walletRepo.fetchHistory(currency)

                withContext(Dispatchers.Main) {
                    val list = res.transactions ?: emptyList()
                    txAdapter.submit(list)

                    if (list.isEmpty()) {
                        showStatus("No transactions yet")
                    } else {
                        hideStatus()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    showStatus("History failed: ${e.message}")
                }
            }
        }
    }

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

    // wallet strip
    private lateinit var rvWalletStrip: RecyclerView
    private var walletStripAdapter: WalletStripAdapter? = null

    // transactions list
    private lateinit var rvTransactions: RecyclerView
    private lateinit var txAdapter: TransactionsAdapter

    private lateinit var wallets: MutableList<WalletBalance>
    private var selectedCode: String = "USDT"
    private var isBalanceHidden: Boolean = false

    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }
    private fun refreshSelectedCurrency() {
        hideStatus()
        fetchBalance(selectedCode)
        fetchHistory(selectedCode)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)


        bindViews()
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)
        swipeRefreshLayout.setOnRefreshListener {
            fetchBalanceAndHistory()
        }


        // Transactions recycler
        rvTransactions.layoutManager = LinearLayoutManager(this)
        txAdapter = TransactionsAdapter()
        rvTransactions.adapter = txAdapter

        // logout
        val tvLogout = findViewById<TextView>(R.id.tvLogout)
        tvLogout.setOnClickListener { doLogout() }

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
        rvTransactions = findViewById(R.id.rvTransactions)
    }

    private fun setupWallets() {
        selectedCode = prefs.getString("selected_wallet", "USDT") ?: "USDT"
        isBalanceHidden = prefs.getBoolean("hide_balance", false)

        // Local UI list (will be updated by fetchBalanceAndHistory())
        wallets = mutableListOf(
            WalletBalance("USDT", "Tether", R.drawable.logo_usdt, 0.0),
            WalletBalance("SSP", "South Sudan Pound", R.drawable.flag_ssp, 0.0),
            WalletBalance("SDG", "Sudanese Pound", R.drawable.flag_sdg, 0.0),
            WalletBalance("EGP", "Egyptian Pound", R.drawable.flag_egp, 0.0),
            WalletBalance("UGX", "Ugandan Shilling", R.drawable.flag_ugx, 0.0)
        )

        applySelectedWallet(selectedCode)
        applyBalanceVisibility()
        setupWalletStrip()
    }

    private fun setupWalletStrip() {
        rvWalletStrip.layoutManager =
            LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)

        walletStripAdapter = WalletStripAdapter(wallets, selectedCode) { picked ->
            selectedCode = picked.code
            prefs.edit().putString("selected_wallet", selectedCode).apply()
            applySelectedWallet(selectedCode)
            walletStripAdapter?.setSelected(selectedCode)

            // ✅ Important: reload balance + transactions for the newly selected currency
            fetchBalanceAndHistory()
            refreshSelectedCurrency()
        }

        rvWalletStrip.adapter = walletStripAdapter
    }

    private fun setupCurrencyPill() {
        btnCurrency.setOnClickListener {
            showWalletPicker { picked ->
                selectedCode = picked.code
                prefs.edit().putString("selected_wallet", selectedCode).apply()
                applySelectedWallet(selectedCode)
                walletStripAdapter?.setSelected(selectedCode)

                // ✅ reload for chosen currency
                fetchBalanceAndHistory()
                refreshSelectedCurrency()
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
        btnSend.setOnClickListener {
            showSendSheet()
        }
    }

    private fun showSendSheet() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_send, null)

        val etPhone = view.findViewById<android.widget.EditText>(R.id.etSendPhone)
        val etAmount = view.findViewById<android.widget.EditText>(R.id.etSendAmount)
        val etDesc = view.findViewById<android.widget.EditText>(R.id.etSendDesc)
        val btn = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnSendNow)

        btn.setOnClickListener {
            val phone = etPhone.text.toString().trim()
            val amount = etAmount.text.toString().trim().toDoubleOrNull()
            val desc = etDesc.text.toString().trim().ifEmpty { null }

            if (phone.isBlank() || amount == null || amount <= 0) {
                android.widget.Toast.makeText(this, "Enter valid phone + amount", android.widget.Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val res = walletRepo.transfer(phone, selectedCode, amount, desc)
                    withContext(Dispatchers.Main) {
                        android.widget.Toast.makeText(this@MainActivity, res.message, android.widget.Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                        // refresh UI after transfer
                        fetchBalanceAndHistory()
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        android.widget.Toast.makeText(this@MainActivity, "Transfer failed: ${e.message}", android.widget.Toast.LENGTH_LONG).show()
                    }
                }
            }
        }

        dialog.setContentView(view)
        dialog.show()
    }


    private fun setupCustomBottomNav() {
        selectTab(0)

        navHome.setOnClickListener { selectTab(0) }
        navCard.setOnClickListener { selectTab(1) }
        navSend.setOnClickListener { selectTab(2) }
        navHub.setOnClickListener { selectTab(3) }
    }

    private fun selectTab(index: Int) {
        screenFlipper.displayedChild = index

        setTabSelected(navHome, iconHome, textHome, index == 0)
        setTabSelected(navCard, iconCard, textCard, index == 1)
        setTabSelected(navSend, iconSend, textSend, index == 2)
        setTabSelected(navHub, iconHub, textHub, index == 3)
    }

    private fun setTabSelected(
        container: LinearLayout,
        icon: ImageView,
        label: TextView,
        selected: Boolean
    ) {
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
        applyBalanceVisibility()
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

        dialog.setContentView(view as android.view.View)
        dialog.show()
    }

    private fun doLogout() {
        // clear token + pin (REAL logout)
        SessionManager(this).clearAll()

        // optional: also clear UI prefs like hide_balance / selected_wallet
        prefs.edit().clear().apply()

        // go to Auth and clear backstack
        val intent = Intent(this, AuthActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        startActivity(intent)
        finish()
    }

    override fun onResume() {
        super.onResume()
        fetchBalanceAndHistory()
        refreshSelectedCurrency()
    }

    /**
     * ✅ This is the missing function.
     * It fetches the selected currency balance + its last transactions
     * and updates UI + RecyclerView.
     */


    private fun fetchBalanceAndHistory() {

        swipeRefreshLayout.isRefreshing = true

        lifecycleScope.launch {
            try {

                // Run network on IO thread
                val bal = withContext(Dispatchers.IO) {
                    walletRepo.fetchBalance(selectedCode)
                }

                val hist = withContext(Dispatchers.IO) {
                    walletRepo.fetchHistory(selectedCode)
                }

                // Update selected wallet amount
                val idx = wallets.indexOfFirst { it.code == selectedCode }
                if (idx != -1) {
                    wallets[idx].amount = bal.balance
                }

                applySelectedWallet(selectedCode)
                walletStripAdapter?.notifyDataSetChanged()

                // Update transactions list
                txAdapter.submit(hist.transactions ?: emptyList())
                val list = hist.transactions ?: emptyList()
                txAdapter.submit(list.take(5))


            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Failed to load wallet: ${e.message}",
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                swipeRefreshLayout.isRefreshing = false
            }
        }
    }

}

/**
 * If you already have this class somewhere else, delete this one to avoid redeclare.
 */
