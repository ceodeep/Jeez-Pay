package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.jeezpay.app.base.BaseFintechActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.jeezpay.app.adapters.TransactionsAdapter
import com.jeezpay.app.adapters.WalletPickerAdapter
import com.jeezpay.app.adapters.WalletStripAdapter
import com.jeezpay.app.repository.WalletRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import androidx.appcompat.app.AlertDialog
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.common.LoaderOverlayController





class MainActivity : BaseFintechActivity() {
    private lateinit var imgProfile: View


    private lateinit var swipeRefreshLayout: SwipeRefreshLayout

    private val walletRepo = WalletRepository()
    private val billsServicesEnabled = false

    private val prefs by lazy { getSharedPreferences("jeezpay_prefs", MODE_PRIVATE) }

    private lateinit var screenFlipper: android.widget.ViewFlipper
    private lateinit var loaderOverlay: LoaderOverlayController
    private var isPagingTransactions = false

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

    private fun showInfoState(message: String) {
        actionText.text = message
        actionText.visibility = View.VISIBLE
        actionText.alpha = 1f
    }

    private fun showErrorState(message: String) {
        actionText.text = message
        actionText.visibility = View.VISIBLE
        actionText.alpha = 1f
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun fadeBalanceText(newText: String) {
        tvBalance.animate()
            .alpha(0f)
            .setDuration(120)
            .withEndAction {
                tvBalance.text = newText
                tvBalance.animate()
                    .alpha(1f)
                    .setDuration(120)
                    .start()
            }
            .start()
    }

    private fun setRefreshing(refreshing: Boolean) {
        if (::swipeRefreshLayout.isInitialized) {
            swipeRefreshLayout.isRefreshing = refreshing
        }
    }

    private fun setBalanceLoading() {
        if (isBalanceHidden) {
            fadeBalanceText("••••••")
        } else {
            fadeBalanceText("Loading...")
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

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                walletRepo.fetchBalanceSafe(currency)
            }) {
                is ApiResult.Success -> {
                    val res = result.data
                    val bal = res.balances.firstOrNull { it.currency == currency }?.balance ?: 0.0

                    val w = wallets.firstOrNull { it.code == currency }
                    if (w != null) {
                        w.amount = bal
                    }
                    applyBalanceVisibility()
                }

                is ApiResult.Error -> {
                    handleMainError(result.error) {
                        fetchBalance(currency)
                    }
                }
            }
        }
    }



    private fun fetchHistory(currency: String) {
        showInfoState("Loading transactions...")

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                walletRepo.fetchHistorySafe(currency)
            }) {
                is ApiResult.Success -> {
                    val list = result.data.transactions ?: emptyList()

                    val visibleList = list.filterNot { tx ->
                        tx.description?.trim()?.equals("Transfer fee", ignoreCase = true) == true ||
                                tx.type?.trim()?.equals("fee", ignoreCase = true) == true
                    }

                    txAdapter.submit(visibleList)

                    if (visibleList.isEmpty()) {
                        showInfoState("No transactions yet")
                    } else {
                        hideStatus()
                    }
                }

                is ApiResult.Error -> {
                    handleMainError(result.error) {
                        fetchHistory(currency)
                    }
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
        initBlockingLoader()

        val imgProfile = findViewById<View>(R.id.imgProfile)

        imgProfile.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }



        bindViews()
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)
        swipeRefreshLayout.setColorSchemeResources(R.color.paypal_blue)
        swipeRefreshLayout.setOnRefreshListener {
            fetchBalanceAndHistory()
        }
        applyHeaderAvatar()
        findViewById<TextView>(R.id.tvSeeAll).setOnClickListener {
            startActivity(
                Intent(this, TransactionsActivity::class.java).apply {
                    putExtra("currency", selectedCode)
                }
            )
        }

        val profileCard = findViewById<View>(R.id.profileCard)
        profileCard.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }
        imgProfile.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }



        // Transactions recycler
        rvTransactions.layoutManager = LinearLayoutManager(this)
        txAdapter = TransactionsAdapter(selectedCode) { tx ->
            TransactionDetailsBottomSheet(
                tx = tx,
                displayCurrency = selectedCode
            ).show(supportFragmentManager, "TransactionDetailsBottomSheet")
        }
        rvTransactions.adapter = txAdapter

        rvTransactions.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                super.onScrolled(recyclerView, dx, dy)

                if (dy <= 0) return
                if (isPagingTransactions) return
                if (!txAdapter.canLoadMore()) return

                val layoutManager = recyclerView.layoutManager as? LinearLayoutManager ?: return
                val lastVisible = layoutManager.findLastVisibleItemPosition()
                val total = txAdapter.itemCount

                if (lastVisible >= total - 3) {
                    isPagingTransactions = true
                    recyclerView.post {
                        txAdapter.loadNextPage()
                        isPagingTransactions = false
                    }
                }
            }
        })

        // logout
//        val tvLogout = findViewById<TextView>(R.id.tvLogout)
//        tvLogout.setOnClickListener { doLogout() }

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



        imgProfile = findViewById(R.id.imgProfile)

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
        walletStripAdapter?.setHideBalances(isBalanceHidden)
        setMainBlockingLoading(true)
    }

    private fun setupWalletStrip() {
        rvWalletStrip.layoutManager =
            LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)

        walletStripAdapter = WalletStripAdapter(wallets, selectedCode, isBalanceHidden) { picked ->
            selectedCode = picked.code
            prefs.edit().putString("selected_wallet", selectedCode).apply()
            applySelectedWallet(selectedCode)
            walletStripAdapter?.setSelected(selectedCode)

            // ✅ Important: reload balance + transactions for the newly selected currency
            setMainBlockingLoading(true)
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
                setMainBlockingLoading(true)
                fetchBalanceAndHistory()
            }
        }
    }

    private fun setupBalanceToggle() {
        btnToggleBalance.setOnClickListener {
            isBalanceHidden = !isBalanceHidden
            prefs.edit().putBoolean("hide_balance", isBalanceHidden).apply()

            walletStripAdapter?.setHideBalances(isBalanceHidden)
            applyBalanceVisibility()

            btnToggleBalance.animate()
                .rotationBy(180f)
                .setDuration(180)
                .start()
        }
    }

    private fun setupActionButtons() {
        val btnSend = findViewById<View>(R.id.btnSend)
        val btnReceive = findViewById<View>(R.id.btnEarn)
        val btnReferral = findViewById<View>(R.id.btnReferral)
        val btnSwap = findViewById<View>(R.id.btnSwap)
        val btnDeposit = findViewById<View>(R.id.btnDeposit)
        val btnBill = findViewById<View>(R.id.btnBill)

        btnDeposit.setOnClickListener {
            startActivity(Intent(this, DepositActivity::class.java))
        }

        btnSend.setOnClickListener {
            startActivity(Intent(this, com.jeezpay.app.send.SendMoneyActivity::class.java))
        }

        btnReferral.setOnClickListener {
            startActivity(Intent(this, ReferralActivity::class.java))
        }
        btnSwap.setOnClickListener {
            startActivity(Intent(this, SwapActivity::class.java))
        }
        btnReceive.setOnClickListener {
            startActivity(Intent(this, ReceiveQrActivity::class.java))
        }
        btnBill.setOnClickListener {
            if (!billsServicesEnabled) {
                AlertDialog.Builder(this)
                    .setTitle("Coming Soon")
                    .setMessage("Bills & Services will be available soon.")
                    .setPositiveButton("OK", null)
                    .show()
                return@setOnClickListener
            }

            startActivity(Intent(this, ServicesActivity::class.java))
        }
    }


    private fun setupCustomBottomNav() {
        selectTab(0)

        navHome.setOnClickListener {
            selectTab(0)
        }

        navCard.setOnClickListener {
            showComingSoon(
                title = "Cards coming soon",
                message = "You’ll soon be able to add and manage JeezPay virtual and physical cards here."
            )
        }

        navSend.setOnClickListener {
            startActivity(Intent(this, com.jeezpay.app.send.SendMoneyActivity::class.java))
        }

        navHub.setOnClickListener {
            showComingSoon(
                title = "JeezPay Hub coming soon",
                message = "The Hub will bring shortcuts, rewards, offers, and account tools into one place."
            )
        }
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
            fadeBalanceText("••••••")
            btnToggleBalance.setImageResource(R.drawable.ic_eye_off)
        } else {
            fadeBalanceText("${nf.format(w.amount)} ${w.code}")
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
        SessionManager(this).clearAll()
        prefs.edit().clear().commit()

        val intent = Intent(this, AuthActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra(AuthActivity.EXTRA_FORCE_LOGIN, true)
        }
        startActivity(intent)
        finish()
    }

    override fun onResume() {
        super.onResume()
        applyHeaderAvatar() // ✅ refresh avatar
        fetchBalanceAndHistory()
    }



    private fun fetchBalanceAndHistory() {
        txAdapter.setCurrency(selectedCode)
        isPagingTransactions = false
        setRefreshing(true)
        showInfoState("Refreshing wallet...")
        txAdapter.showSkeleton()

        lifecycleScope.launch {
            try {
                val balancesMap = mutableMapOf<String, Double>()

                for (w in wallets) {
                    when (val result = withContext(Dispatchers.IO) {
                        walletRepo.fetchBalanceSafe(w.code)
                    }) {
                        is ApiResult.Success -> {
                            balancesMap[w.code] =
                                result.data.balances.firstOrNull { it.currency == w.code }?.balance ?: 0.0
                        }

                        is ApiResult.Error -> {
                            setRefreshing(false)
                            handleMainError(result.error) {
                                fetchBalanceAndHistory()
                            }
                            return@launch
                        }
                    }
                }

                for (i in wallets.indices) {
                    val code = wallets[i].code
                    balancesMap[code]?.let { wallets[i].amount = it }
                }

                when (val histResult = withContext(Dispatchers.IO) {
                    walletRepo.fetchHistorySafe(selectedCode)
                }) {
                    is ApiResult.Success -> {
                        applySelectedWallet(selectedCode)
                        walletStripAdapter?.notifyDataSetChanged()

                        val list = histResult.data.transactions ?: emptyList()

                        val visibleList = list.filterNot { tx ->
                            tx.description?.trim()?.equals("Transfer fee", ignoreCase = true) == true ||
                                    tx.type?.trim()?.equals("fee", ignoreCase = true) == true
                        }

                        txAdapter.submit(visibleList)
                        isPagingTransactions = false

                        if (visibleList.isEmpty()) {
                            showInfoState("No transactions yet")
                        } else {
                            hideStatus()
                        }
                    }

                    is ApiResult.Error -> {
                        handleMainError(histResult.error) {
                            fetchBalanceAndHistory()
                        }
                    }
                }
            } finally {
                setRefreshing(false)
                setMainBlockingLoading(false)
            }
        }
    }






    private fun handleMainError(
        error: AppError,
        retryAction: () -> Unit = {}
    ) {
        handleCommonError(
            error = error,
            retryAction = retryAction,
            onValidation = { showErrorState(it) },
            onUnauthorized = {
                doLogout()
            }
        )
    }

    private fun showKycRequiredDialog() {
        AlertDialog.Builder(this)
            .setTitle("KYC Required")
            .setMessage("You must complete KYC to unlock transfers & higher limits.")
            .setPositiveButton("Start KYC") { _, _ ->
                startActivity(Intent(this, KycActivity::class.java))
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showKycPendingDialog() {
        AlertDialog.Builder(this)
            .setTitle("KYC Pending")
            .setMessage("Your KYC is under review. Transfers are disabled until approval.")
            .setPositiveButton("View KYC") { _, _ ->
                startActivity(Intent(this, KycActivity::class.java))
            }
            .setNegativeButton("Cancel", null)
            .show()
    }



    private fun setMainBlockingLoading(loading: Boolean) {

        if (loading) showBlockingLoader()
        else hideBlockingLoader()

        navHome.isEnabled = !loading
        navCard.isEnabled = !loading
        navSend.isEnabled = !loading
        navHub.isEnabled = !loading

        btnCurrency.isEnabled = !loading
        btnToggleBalance.isEnabled = !loading
    }

    private val avatarOptions = listOf(
        "avatar_1" to R.drawable.avatar_1,
        "avatar_2" to R.drawable.avatar_2,
        "avatar_3" to R.drawable.avatar_3,
        "avatar_4" to R.drawable.avatar_4,
        "avatar_5" to R.drawable.avatar_5,
        "avatar_6" to R.drawable.avatar_6
    )

    private fun getSelectedAvatarKey(): String {
        return prefs.getString("selected_avatar", "avatar_1") ?: "avatar_1"
    }

    private fun getAvatarResIdFromKey(key: String): Int {
        return avatarOptions.firstOrNull { it.first == key }?.second
            ?: R.drawable.avatar_1
    }

    private fun applyHeaderAvatar() {
        val key = getSelectedAvatarKey()
        val resId = getAvatarResIdFromKey(key)

        val imageView = findViewById<ImageView>(R.id.imgProfile)
        imageView.setImageResource(resId)
    }
    private fun showComingSoon(title: String, message: String) {
        MaterialAlertDialogBuilder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("Got it", null)
            .show()
    }
}

