package com.jeezpay.app

import retrofit2.HttpException
import org.json.JSONObject

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
    private lateinit var profileCard: View

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
    private fun normalizePhoneSudan(raw: String): String {
        val p = raw.trim()
        val digits = p.replace(Regex("\\D"), "")

        return when {
            digits.startsWith("0") && digits.length >= 10 -> "+249" + digits.substring(1)
            digits.startsWith("249") -> "+249" + digits.substring(3)
            p.startsWith("+") && digits.length >= 8 -> "+" + digits
            digits.length == 9 -> "+249$digits"
            else -> p
        }
    }


    private fun getMyPhoneFromJwt(): String? {
        val token = SessionManager(this).getToken() ?: return null

        return try {
            val parts = token.split(".")
            if (parts.size < 2) return null

            val payload = String(
                android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE)
            )

            org.json.JSONObject(payload).optString("phone", null)

        } catch (_: Exception) {
            null
        }
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

        val profileCard = findViewById<View>(R.id.profileCard)
        profileCard.setOnClickListener {
            startActivity(Intent(this, KycActivity::class.java))
        }


        profileCard.setOnClickListener {
            startActivity(Intent(this, KycActivity::class.java))
        }



        // Transactions recycler
        rvTransactions.layoutManager = LinearLayoutManager(this)
        txAdapter = TransactionsAdapter(selectedCode)
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



        profileCard = findViewById(R.id.profileCard)

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
        txAdapter.setCurrency(selectedCode)


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

        val spCountry = view.findViewById<android.widget.Spinner>(R.id.spCountryCode)
        val tvHint = view.findViewById<TextView>(R.id.tvSendPhoneHint)

        // ---- Country codes (you can add more later) ----
        val countryItems = listOf(
            "Sudan (+249)",
            "South Sudan (+211)",
            "Egypt (+20)",
            "Uganda (+256)"
        )
        val countryCodes = mapOf(
            "Sudan (+249)" to "+249",
            "South Sudan (+211)" to "+211",
            "Egypt (+20)" to "+20",
            "Uganda (+256)" to "+256"
        )

        spCountry.adapter = android.widget.ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            countryItems
        )

        // Default to Sudan (+249)
        spCountry.setSelection(0)

        val myPhone = getMyPhoneFromJwt() // uses SessionManager token

        fun showHint(text: String, isError: Boolean = false) {
            tvHint.visibility = View.VISIBLE
            tvHint.text = text
            tvHint.setTextColor(
                if (isError) getColor(android.R.color.holo_red_dark)
                else getColor(R.color.text_tertiary)
            )
        }

        fun hideHint() {
            tvHint.text = ""
            tvHint.visibility = View.GONE
        }

        fun normalizeWithSelectedCountry(raw: String): String {
            val p = raw.trim()
            val digits = p.replace("\\D".toRegex(), "")

            val selectedLabel = spCountry.selectedItem?.toString() ?: "Sudan (+249)"
            val cc = countryCodes[selectedLabel] ?: "+249"

            // If already starts with +
            if (p.startsWith("+") && digits.isNotBlank()) return "+$digits"

            // If starts with 00 (international)
            if (digits.startsWith("00") && digits.length > 2) return "+" + digits.substring(2)

            // If user typed country code without plus (e.g. 249xxxxxxxxx)
            if (digits.startsWith(cc.replace("+", ""))) return cc + digits.removePrefix(cc.replace("+", ""))

            // If user typed local starting 0 (0xxxxxxxxx) -> drop 0 then prefix cc
            if (digits.startsWith("0") && digits.length >= 10) return cc + digits.substring(1)

            // If they typed just digits (no 0) -> prefix cc
            if (digits.length in 7..12) return cc + digits

            // fallback
            return p
        }

        fun isSendingToSelf(normalizedTarget: String): Boolean {
            if (myPhone.isNullOrBlank()) return false
            val mine = normalizeWithSelectedCountry(myPhone) // normalize mine too
            return mine == normalizedTarget
        }

        fun validateLive() {
            val raw = etPhone.text.toString()
            if (raw.isBlank()) {
                hideHint()
                btn.isEnabled = true
                return
            }

            val normalized = normalizeWithSelectedCountry(raw)

            // Show a friendly preview
            showHint("Will send to: $normalized")

            // Disable if sending to self
            if (isSendingToSelf(normalized)) {
                btn.isEnabled = false
                showHint("You can’t send money to your own number.", isError = true)
            } else {
                btn.isEnabled = true
            }
        }

        // Re-check when typing or changing country
        etPhone.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                validateLive()
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })

        spCountry.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: android.widget.AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                validateLive()
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }

        // Initial state
        validateLive()

        btn.setOnClickListener {
            val phoneRaw = etPhone.text.toString().trim()
            val phone = normalizeWithSelectedCountry(phoneRaw)

            val amount = etAmount.text.toString().trim().toDoubleOrNull()
            val desc = etDesc.text.toString().trim().ifEmpty { null }

            if (phoneRaw.isBlank() || amount == null || amount <= 0) {
                Toast.makeText(this, "Enter valid phone + amount", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // Final safety block
            if (isSendingToSelf(phone)) {
                btn.isEnabled = false
                showHint("You can’t send money to your own number.", isError = true)
                return@setOnClickListener
            }

            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val res = walletRepo.transfer(phone, selectedCode, amount, desc)
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, res.message, Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                        fetchBalanceAndHistory()
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@MainActivity,
                            "Transfer failed: ${e.message}",
                            Toast.LENGTH_LONG
                        ).show()
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

    }

    /**
     * ✅ This is the missing function.
     * It fetches the selected currency balance + its last transactions
     * and updates UI + RecyclerView.
     */


    private fun fetchBalanceAndHistory() {
        txAdapter.setCurrency(selectedCode)

        // start spinner only if view is ready
        if (::swipeRefreshLayout.isInitialized) {
            swipeRefreshLayout.isRefreshing = true
        }

        lifecycleScope.launch {
            try {
                // 1) Fetch balances for ALL wallets
                val balancesMap: Map<String, Double> = withContext(Dispatchers.IO) {
                    val map = mutableMapOf<String, Double>()
                    for (w in wallets) {
                        try {
                            val res = walletRepo.fetchBalance(w.code)
                            map[w.code] = res.balance
                        } catch (_: Exception) {
                            // keep last known value if one currency fails
                        }
                    }
                    map
                }

                // apply balances to list
                for (i in wallets.indices) {
                    val code = wallets[i].code
                    balancesMap[code]?.let { wallets[i].amount = it }
                }

                // 2) Fetch history ONLY for selected wallet
                val hist = withContext(Dispatchers.IO) {
                    walletRepo.fetchHistory(selectedCode)
                }

                // 3) Update UI
                applySelectedWallet(selectedCode)              // updates pill + main balance text
                walletStripAdapter?.notifyDataSetChanged()     // updates horizontal wallet strip

                val list = hist.transactions ?: emptyList()
                txAdapter.submit(list.take(5))                 // show 5 recent (as you want)

                if (list.isEmpty()) showStatus("No transactions yet") else hideStatus()

            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Failed to load wallet: ${e.message}",
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                if (::swipeRefreshLayout.isInitialized) {
                    swipeRefreshLayout.isRefreshing = false
                }
            }
        }
    }


}

/**
 * If you already have this class somewhere else, delete this one to avoid redeclare.
 */
