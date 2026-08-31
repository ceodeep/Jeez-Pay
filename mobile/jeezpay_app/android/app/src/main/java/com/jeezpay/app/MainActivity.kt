package com.jeezpay.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.adapters.TransactionsAdapter
import com.jeezpay.app.adapters.WalletPickerAdapter
import com.jeezpay.app.adapters.WalletStripAdapter
import com.jeezpay.app.base.BaseFintechActivity
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.ProductCapabilitiesResponse
import com.jeezpay.app.network.dto.ProductCapability
import com.jeezpay.app.repository.ProductPolicyStore
import com.jeezpay.app.repository.ProductRepository
import com.jeezpay.app.repository.WalletRepository
import com.jeezpay.app.storage.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale

class MainActivity : BaseFintechActivity() {

    private lateinit var imgProfile: View
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout

    private val walletRepo = WalletRepository()
    private val productRepo = ProductRepository()
    private val billsServicesEnabled = false

    private val prefs by lazy { getSharedPreferences("jeezpay_prefs", MODE_PRIVATE) }

    private lateinit var screenFlipper: android.widget.ViewFlipper
    private var isPagingTransactions = false
    private var handledPendingMerchantPayment = false
    private var productPolicyLoaded = false
    private var productPolicyLoading = false

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

    // wallet strip
    private lateinit var rvWalletStrip: RecyclerView
    private var walletStripAdapter: WalletStripAdapter? = null

    // transactions list
    private lateinit var rvTransactions: RecyclerView
    private lateinit var txAdapter: TransactionsAdapter

    private lateinit var wallets: MutableList<WalletBalance>
    private var selectedCode: String = ""
    private var isBalanceHidden: Boolean = false

    private val nf = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        initBlockingLoader()

        bindViews()
        setupRefresh()
        setupProfileNavigation()
        setupTransactions()
        setupWallets()
        setupCurrencyPill()
        setupBalanceToggle()
        setupActionButtons()
        setupCustomBottomNav()
        applyHeaderAvatar()

        loadProductPolicyAndWallet()
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
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)
    }

    private fun setupRefresh() {
        swipeRefreshLayout.setColorSchemeResources(R.color.paypal_blue)
        swipeRefreshLayout.setOnRefreshListener {
            loadProductPolicyAndWallet(forcePolicyRefresh = true)
        }
    }

    private fun setupProfileNavigation() {
        imgProfile.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }

        findViewById<View>(R.id.profileCard).setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }

        findViewById<TextView>(R.id.tvSeeAll).setOnClickListener {
            if (!requireEnabledCurrency()) return@setOnClickListener

            startActivity(
                Intent(this, TransactionsActivity::class.java).apply {
                    putExtra("currency", selectedCode)
                }
            )
        }
    }

    private fun setupTransactions() {
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

                if (dy <= 0 || isPagingTransactions || !txAdapter.canLoadMore()) return

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
    }

    private fun setupWallets() {
        isBalanceHidden = prefs.getBoolean("hide_balance", false)
        wallets = mutableListOf()

        tvCurrency.text = "--"
        tvBalance.text = if (isBalanceHidden) "••••••" else "Loading..."

        rvWalletStrip.layoutManager =
            LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)

        walletStripAdapter = WalletStripAdapter(
            wallets,
            selectedCode,
            isBalanceHidden
        ) { picked ->
            if (!ProductPolicyStore.isCurrencyEnabled(picked.code)) {
                showErrorState("This wallet is not available right now")
                return@WalletStripAdapter
            }

            selectWallet(picked.code)
            setMainBlockingLoading(true)
            fetchBalanceAndHistory()
        }

        rvWalletStrip.adapter = walletStripAdapter
    }

    private fun setupCurrencyPill() {
        btnCurrency.setOnClickListener {
            if (!productPolicyLoaded) {
                showErrorState("Wallet products are still loading")
                return@setOnClickListener
            }

            if (wallets.size <= 1) return@setOnClickListener

            showWalletPicker { picked ->
                selectWallet(picked.code)
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
        val btnWithdraw = findViewById<View>(R.id.btnWithdraw)

        btnDeposit.setOnClickListener {
            runCapabilityAction(ProductCapability.CASH_IN) {
                startActivity(
                    Intent(this, DepositActivity::class.java)
                        .putExtra("currency", selectedCode)
                )
            }
        }

        btnSend.setOnClickListener {
            runCapabilityAction(ProductCapability.P2P_TRANSFER) {
                startActivity(
                    Intent(this, com.jeezpay.app.send.SendMoneyActivity::class.java)
                        .putExtra("currency", selectedCode)
                )
            }
        }

        btnReferral.setOnClickListener {
            startActivity(Intent(this, ReferralActivity::class.java))
        }

        btnSwap.setOnClickListener {
            runCapabilityAction(ProductCapability.FX_CONVERT) {
                startActivity(Intent(this, SwapActivity::class.java))
            }
        }

        btnReceive.setOnClickListener {
            runCapabilityAction(ProductCapability.P2P_TRANSFER) {
                startActivity(
                    Intent(this, ReceiveQrActivity::class.java)
                        .putExtra("currency", selectedCode)
                )
            }
        }

        btnBill.setOnClickListener {
            if (!billsServicesEnabled) {
                showComingSoon(
                    title = "Bills & Services",
                    message = "Bill payments and service requests are currently in development. Soon you’ll be able to pay bills, request services, and manage payments directly from JeezPay.",
                    icon = "🧾"
                )
                return@setOnClickListener
            }

            startActivity(Intent(this, ServicesActivity::class.java))
        }

        btnWithdraw.setOnClickListener {
            runCapabilityAction(ProductCapability.CASH_OUT) {
                if (selectedCode == "USDT") {
                    // Crypto withdrawal is a separate product and is not part of
                    // the SSP launch. This branch remains for future enablement.
                    if (!ProductPolicyStore.isCapabilityEnabled(
                            "USDT",
                            ProductCapability.USDT_SEND
                        )
                    ) {
                        showErrorState("USDT withdrawals are not available right now")
                        return@runCapabilityAction
                    }

                    startActivity(
                        Intent(this, WithdrawActivity::class.java)
                            .putExtra("currency", "USDT")
                    )
                } else {
                    showComingSoon(
                        title = "Cash Out",
                        message = "Cash-out for $selectedCode is enabled for the launch product, but the mobile cash-out flow is not available in this build yet."
                    )
                }
            }
        }
    }

    private fun setupCustomBottomNav() {
        selectTab(0)

        navHome.setOnClickListener {
            selectTab(0)
        }

        navCard.setOnClickListener {
            showComingSoon(
                title = "JeezPay Cards",
                message = "Virtual and physical cards are currently in development. Soon you’ll be able to pay online, withdraw from ATMs, and manage your cards directly from JeezPay.",
                icon = "💳"
            )
        }

        navSend.setOnClickListener {
            runCapabilityAction(ProductCapability.P2P_TRANSFER) {
                startActivity(
                    Intent(this, com.jeezpay.app.send.SendMoneyActivity::class.java)
                        .putExtra("currency", selectedCode)
                )
            }
        }

        navHub.setOnClickListener {
            showComingSoon(
                title = "JeezPay Hub coming soon",
                message = "The Hub will bring shortcuts, rewards, offers, and account tools into one place."
            )
        }
    }

    private fun loadProductPolicyAndWallet(forcePolicyRefresh: Boolean = false) {
        if (productPolicyLoading) return

        val cached = ProductPolicyStore.current()
        if (!forcePolicyRefresh && cached != null) {
            applyProductConfiguration(cached)
            fetchBalanceAndHistory()
            return
        }

        productPolicyLoading = true
        productPolicyLoaded = false
        setMainBlockingLoading(true)
        setRefreshing(true)
        showInfoState("Loading available wallet products...")

        lifecycleScope.launch {
            when (val result = withContext(Dispatchers.IO) {
                productRepo.fetchCapabilitiesSafe(ProductPolicyStore.LAUNCH_COUNTRY_CODE)
            }) {
                is ApiResult.Success -> {
                    val config = result.data
                    val defaultCurrency = config.defaultCurrency
                        ?.trim()
                        ?.uppercase()
                        ?.takeIf { it.isNotBlank() }

                    if (defaultCurrency == null || config.products.isEmpty()) {
                        failProductPolicy("No wallet product is currently available")
                        return@launch
                    }

                    ProductPolicyStore.replace(config)
                    applyProductConfiguration(config)
                    productPolicyLoading = false
                    fetchBalanceAndHistory()
                    openPendingMerchantPaymentIfAny()
                }

                is ApiResult.Error -> {
                    ProductPolicyStore.clear()
                    failProductPolicy("Couldn’t load available wallet products")
                    handleMainError(result.error) {
                        loadProductPolicyAndWallet(forcePolicyRefresh = true)
                    }
                }
            }
        }
    }

    private fun applyProductConfiguration(config: ProductCapabilitiesResponse) {
        val previousAmounts = wallets.associate { it.code to it.amount }

        val enabledWallets = config.products.mapNotNull { product ->
            val code = product.currency.trim().uppercase()
            if (code.isBlank()) return@mapNotNull null

            WalletBalance(
                code = code,
                name = product.displayName.ifBlank { code },
                iconRes = walletIconFor(code),
                amount = previousAmounts[code] ?: 0.0
            )
        }

        if (enabledWallets.isEmpty()) {
            failProductPolicy("No wallet product is currently available")
            return
        }

        wallets.clear()
        wallets.addAll(enabledWallets)

        val savedSelection = prefs.getString("selected_wallet", null)
            ?.trim()
            ?.uppercase()

        val defaultCurrency = config.defaultCurrency
            ?.trim()
            ?.uppercase()
            ?.takeIf { ProductPolicyStore.isCurrencyEnabled(it) }
            ?: enabledWallets.first().code

        selectedCode = savedSelection
            ?.takeIf { ProductPolicyStore.isCurrencyEnabled(it) }
            ?: defaultCurrency

        prefs.edit().putString("selected_wallet", selectedCode).apply()

        productPolicyLoaded = true
        txAdapter.setCurrency(selectedCode)
        walletStripAdapter?.setSelected(selectedCode)
        walletStripAdapter?.notifyDataSetChanged()
        walletStripAdapter?.setHideBalances(isBalanceHidden)

        applySelectedWallet(selectedCode)
        applyActionVisibility(config)
    }

    private fun applyActionVisibility(config: ProductCapabilitiesResponse) {
        val hasFx = config.products.any {
            it.isCapabilityEnabled(ProductCapability.FX_CONVERT)
        }

        // FX is fully hidden when the server says it is unavailable. Other
        // launch actions stay visible and are capability-checked on tap.
        findViewById<View>(R.id.btnSwap).visibility = if (hasFx) View.VISIBLE else View.GONE
    }

    private fun walletIconFor(currency: String): Int {
        return when (currency) {
            "USDT" -> R.drawable.logo_usdt
            "SSP" -> R.drawable.flag_ssp
            "SDG" -> R.drawable.flag_sdg
            "EGP" -> R.drawable.flag_egp
            "UGX" -> R.drawable.flag_ugx
            else -> android.R.drawable.ic_menu_info_details
        }
    }

    private fun selectWallet(code: String) {
        val normalized = code.trim().uppercase()
        if (!ProductPolicyStore.isCurrencyEnabled(normalized)) return

        selectedCode = normalized
        prefs.edit().putString("selected_wallet", selectedCode).apply()
        txAdapter.setCurrency(selectedCode)
        walletStripAdapter?.setSelected(selectedCode)
        applySelectedWallet(selectedCode)
    }

    private fun fetchBalanceAndHistory() {
        if (!productPolicyLoaded || !requireEnabledCurrency(showMessage = false)) {
            setRefreshing(false)
            setMainBlockingLoading(false)
            return
        }

        txAdapter.setCurrency(selectedCode)
        isPagingTransactions = false
        setRefreshing(true)
        showInfoState("Refreshing wallet...")
        txAdapter.showSkeleton()

        lifecycleScope.launch {
            try {
                when (val balancesResult = withContext(Dispatchers.IO) {
                    walletRepo.fetchBalancesSafe()
                }) {
                    is ApiResult.Success -> {
                        val balancesByCurrency = balancesResult.data.balances.associate {
                            it.currency.trim().uppercase() to it.balance
                        }

                        for (wallet in wallets) {
                            wallet.amount = balancesByCurrency[wallet.code] ?: 0.0
                        }
                    }

                    is ApiResult.Error -> {
                        handleMainError(balancesResult.error) {
                            fetchBalanceAndHistory()
                        }
                        return@launch
                    }
                }

                when (val histResult = withContext(Dispatchers.IO) {
                    walletRepo.fetchHistorySafe(selectedCode)
                }) {
                    is ApiResult.Success -> {
                        applySelectedWallet(selectedCode)
                        walletStripAdapter?.notifyDataSetChanged()

                        val list = histResult.data.transactions ?: emptyList()
                        txAdapter.submit(list)
                        isPagingTransactions = false

                        if (list.isEmpty()) {
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

    private fun runCapabilityAction(capability: String, action: () -> Unit) {
        if (!requireEnabledCurrency()) return

        if (!ProductPolicyStore.isCapabilityEnabled(selectedCode, capability)) {
            showErrorState("This action is not available for $selectedCode right now")
            return
        }

        action()
    }

    private fun requireEnabledCurrency(showMessage: Boolean = true): Boolean {
        val enabled = productPolicyLoaded &&
            selectedCode.isNotBlank() &&
            ProductPolicyStore.isCurrencyEnabled(selectedCode)

        if (!enabled && showMessage) {
            showErrorState("Wallet products are unavailable. Pull down to retry.")
        }

        return enabled
    }

    private fun failProductPolicy(message: String) {
        productPolicyLoading = false
        productPolicyLoaded = false
        ProductPolicyStore.clear()

        wallets.clear()
        walletStripAdapter?.notifyDataSetChanged()
        selectedCode = ""
        tvCurrency.text = "--"
        tvBalance.text = "Unavailable"
        txAdapter.submit(emptyList())

        setRefreshing(false)
        setMainBlockingLoading(false)
        showInfoState(message)
    }

    private fun applySelectedWallet(code: String) {
        val wallet = wallets.firstOrNull { it.code == code } ?: return
        imgCurrency.setImageResource(wallet.iconRes)
        tvCurrency.text = wallet.code
        applyBalanceVisibility()
    }

    private fun applyBalanceVisibility() {
        val wallet = wallets.firstOrNull { it.code == selectedCode }

        if (wallet == null) {
            tvBalance.text = if (isBalanceHidden) "••••••" else "Unavailable"
            return
        }

        if (isBalanceHidden) {
            fadeBalanceText("••••••")
            btnToggleBalance.setImageResource(R.drawable.ic_eye_off)
        } else {
            fadeBalanceText("${nf.format(wallet.amount)} ${wallet.code}")
            btnToggleBalance.setImageResource(R.drawable.ic_eye)
        }
    }

    private fun showWalletPicker(onPicked: (WalletBalance) -> Unit) {
        if (wallets.isEmpty()) return

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

    private fun openPendingMerchantPaymentIfAny() {
        if (handledPendingMerchantPayment || !productPolicyLoaded) return

        val id = prefs.getString("pending_merchant_payment_id", null)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?: return

        handledPendingMerchantPayment = true
        prefs.edit().remove("pending_merchant_payment_id").apply()

        startActivity(
            Intent(this, MerchantPaymentActivity::class.java).apply {
                putExtra(MerchantPaymentActivity.EXTRA_PAYMENT_ID, id)
            }
        )
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

    private fun setRefreshing(refreshing: Boolean) {
        if (::swipeRefreshLayout.isInitialized) {
            swipeRefreshLayout.isRefreshing = refreshing
        }
    }

    private fun setMainBlockingLoading(loading: Boolean) {
        if (loading) showBlockingLoader() else hideBlockingLoader()

        navHome.isEnabled = !loading
        navCard.isEnabled = !loading
        navSend.isEnabled = !loading && productPolicyLoaded
        navHub.isEnabled = !loading

        btnCurrency.isEnabled = !loading && productPolicyLoaded && wallets.size > 1
        btnToggleBalance.isEnabled = !loading && productPolicyLoaded
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

    private fun hideStatus() {
        actionText.text = ""
        actionText.visibility = View.GONE
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

    private fun handleMainError(
        error: AppError,
        retryAction: () -> Unit = {}
    ) {
        handleCommonError(
            error = error,
            retryAction = retryAction,
            onValidation = { showErrorState(it) },
            onUnauthorized = { doLogout() }
        )
    }

    private fun doLogout() {
        ProductPolicyStore.clear()
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
        applyHeaderAvatar()

        if (productPolicyLoaded && !productPolicyLoading) {
            fetchBalanceAndHistory()
            openPendingMerchantPaymentIfAny()
        }
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
        val imageView = findViewById<ImageView>(R.id.imgProfile)
        imageView.setImageResource(getAvatarResIdFromKey(key))
    }

    private fun showComingSoon(
        title: String,
        message: String,
        icon: String = "✨"
    ) {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.bottom_sheet_coming_soon, null)

        view.findViewById<TextView>(R.id.tvComingSoonIcon).text = icon
        view.findViewById<TextView>(R.id.tvComingSoonTitle).text = title
        view.findViewById<TextView>(R.id.tvComingSoonMessage).text = message

        view.findViewById<MaterialButton>(R.id.btnComingSoonClose).setOnClickListener {
            dialog.dismiss()
        }

        dialog.setContentView(view)
        dialog.show()
    }
}
