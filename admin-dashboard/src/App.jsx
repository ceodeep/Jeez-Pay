import { useEffect, useState } from "react";
import api from "./lib/api";
import LoginPage from "./pages/LoginPage";

function StatusBadge({ value }) {
  const normalized = String(value || "").toLowerCase();

  const styles = {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "capitalize",
  };

  if (
    normalized === "approved" ||
    normalized === "credit" ||
    normalized === "active" ||
    normalized === "enabled"
  ) {
    return (
      <span style={{ ...styles, background: "#e8f7ee", color: "#18794e" }}>
        {value}
      </span>
    );
  }

  if (normalized === "pending") {
    return (
      <span style={{ ...styles, background: "#fff7e6", color: "#b26a00" }}>
        {value}
      </span>
    );
  }

  if (
    normalized === "rejected" ||
    normalized === "debit" ||
    normalized === "suspended" ||
    normalized === "disabled"
  ) {
    return (
      <span style={{ ...styles, background: "#fdecec", color: "#c0392b" }}>
        {value}
      </span>
    );
  }

  return (
    <span style={{ ...styles, background: "#eef2f7", color: "#475569" }}>
      {value}
    </span>
  );
}

function Card({ title, value }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div style={{ fontSize: 14, color: "#64748b", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#0f172a" }}>
        {value}
      </div>
    </div>
  );
}

function AppShell({ onLogout }) {
  const [page, setPage] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [adminProfile, setAdminProfile] = useState(null);
  const [adminPermissions, setAdminPermissions] = useState([]);
  const [roleMatrix, setRoleMatrix] = useState({});
  const [allPermissions, setAllPermissions] = useState([]);
  const [manageableRoles, setManageableRoles] = useState([]);
  const [roleUpdateLoadingUserId, setRoleUpdateLoadingUserId] = useState("");
  const [userRoleDrafts, setUserRoleDrafts] = useState({});

  const [kycs, setKycs] = useState([]);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

    const [withdrawals, setWithdrawals] = useState([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [withdrawStatusFilter, setWithdrawStatusFilter] = useState("all");
  const [withdrawSearch, setWithdrawSearch] = useState("");
  const [withdrawActionLoadingId, setWithdrawActionLoadingId] = useState("");

  const [selectedUserDetails, setSelectedUserDetails] = useState(null);
  const [userDetailsLoading, setUserDetailsLoading] = useState(false);
  const [showUserDetails, setShowUserDetails] = useState(false);

  const [walletViewData, setWalletViewData] = useState(null);
  const [walletViewLoading, setWalletViewLoading] = useState(false);
  const [walletIdentifier, setWalletIdentifier] = useState("");

  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    dailyTransferLimit: "",
    kycRequired: true,
    maintenanceMode: false,
    supportedCurrencies: "USDT,SSP,SDG,EGP,UGX",
  });

  const [currencySettingsLoading, setCurrencySettingsLoading] = useState(false);
  const [currencySettings, setCurrencySettings] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [currencyForm, setCurrencyForm] = useState({
    feePercent: "",
    flatFee: "",
    minTransfer: "",
    maxTransfer: "",
    isEnabled: true,
  });

  const [stats, setStats] = useState({
    totalUsers: 0,
    pendingKyc: 0,
    suspendedUsers: 0,
    totalTransactionsToday: 0,
    totalVolumeToday: 0,
    totalAgents: 0,
    totalMerchants: 0,
  });

  const [kycStatusFilter, setKycStatusFilter] = useState("all");

  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");

  const [txTypeFilter, setTxTypeFilter] = useState("all");
  const [txSearch, setTxSearch] = useState("");
  const [txReference, setTxReference] = useState("");

  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");

  const [adjustForm, setAdjustForm] = useState({
    identifier: "",
    currency: "USDT",
    amount: "",
    type: "credit",
    description: "",
  });

    function hasPermission(permission) {
    return (
      adminPermissions.includes("*") || adminPermissions.includes(permission)
    );
  }

  function canAccessPage(key) {
    if (hasPermission("*")) return true;

        const pagePermissions = {
      dashboard: "dashboard.view",
      kyc: "kyc.view",
      users: "users.view",
      transactions: "transactions.view",
      withdrawals: "transactions.view",
      auditLogs: "audit_logs.view",
      walletView: "wallets.view",
      wallet: "wallets.adjust",
      settings: "settings.view",
      currencySettings: "currency_settings.view",
      roles: "users.role.update",
    };

    const required = pagePermissions[key];
    return required ? hasPermission(required) : false;
  }

    async function loadMyPermissions() {
    try {
      const res = await api.get("/admin/me/permissions");
      setAdminProfile(res.data?.admin || null);
      setAdminPermissions(res.data?.permissions || []);
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load admin permissions"
      );
    }
  }

  async function loadRoleMatrix() {
    try {
      const res = await api.get("/admin/roles/permissions");
      setRoleMatrix(res.data?.roles || {});
      setAllPermissions(res.data?.allPermissions || []);
      setManageableRoles(res.data?.manageableRoles || []);
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load role permissions"
      );
    }
  }

  async function loadDashboardStats() {
    setLoading(true);
    setMessage("");

    try {
      const res = await api.get("/admin/dashboard/stats");
      setStats(
        res.data.stats || {
          totalUsers: 0,
          pendingKyc: 0,
          suspendedUsers: 0,
          totalTransactionsToday: 0,
          totalVolumeToday: 0,
          totalAgents: 0,
          totalMerchants: 0,
        }
      );
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load dashboard stats"
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadKycs() {
    setLoading(true);
    setMessage("");

    try {
      const url =
        kycStatusFilter === "all"
          ? "/admin/kyc/list"
          : `/admin/kyc/list?status=${kycStatusFilter}`;

      const res = await api.get(url);
      setKycs(res.data.kycs || []);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load KYC list");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    setLoading(true);
    setMessage("");

    try {
      let url = "/admin/users";
      const params = [];

      if (userRoleFilter !== "all") {
        params.push(`role=${userRoleFilter}`);
      }

      if (userSearch.trim()) {
        params.push(`search=${encodeURIComponent(userSearch.trim())}`);
      }

      if (params.length > 0) {
        url += "?" + params.join("&");
      }

      const res = await api.get(url);
      setUsers(res.data.users || []);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function loadUserDetails(identifier) {
    setUserDetailsLoading(true);
    setMessage("");

    try {
      const res = await api.get(
        `/admin/user/details?identifier=${encodeURIComponent(identifier)}`
      );

      setSelectedUserDetails(res.data || null);
      setShowUserDetails(true);
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load user details"
      );
    } finally {
      setUserDetailsLoading(false);
    }
  }

  async function loadTransactions() {
    setLoading(true);
    setMessage("");

    try {
      let url = "/admin/transactions";
      const params = [];

      if (txTypeFilter !== "all") {
        params.push(`type=${txTypeFilter}`);
      }

      if (txSearch.trim()) {
        params.push(`search=${encodeURIComponent(txSearch.trim())}`);
      }

      if (txReference.trim()) {
        params.push(`reference=${encodeURIComponent(txReference.trim())}`);
      }

      if (params.length > 0) {
        url += "?" + params.join("&");
      }

      const res = await api.get(url);
      setTransactions(res.data.transactions || []);
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load transactions"
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditLogs() {
    setLoading(true);
    setMessage("");

    try {
      let url = "/admin/audit-logs";
      const params = [];

      if (auditActionFilter !== "all") {
        params.push(`action=${encodeURIComponent(auditActionFilter)}`);
      }

      if (auditSearch.trim()) {
        params.push(`search=${encodeURIComponent(auditSearch.trim())}`);
      }

      if (params.length > 0) {
        url += "?" + params.join("&");
      }

      const res = await api.get(url);
      setAuditLogs(res.data.logs || []);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

    async function loadWithdrawals() {
    setWithdrawalsLoading(true);
    setMessage("");

    try {
      const params = [];

      if (withdrawStatusFilter !== "all") {
        params.push(`status=${encodeURIComponent(withdrawStatusFilter)}`);
      }

      if (withdrawSearch.trim()) {
        params.push(`search=${encodeURIComponent(withdrawSearch.trim())}`);
      }

      const url =
        params.length > 0
          ? `/admin/withdrawals?${params.join("&")}`
          : "/admin/withdrawals";

      const res = await api.get(url);
      setWithdrawals(res.data?.withdrawals || []);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load withdrawals");
    } finally {
      setWithdrawalsLoading(false);
    }
  }

  async function approveWithdrawal(withdrawalId) {
    if (!withdrawalId) return;

    try {
      setWithdrawActionLoadingId(withdrawalId);
      await api.post(`/admin/withdrawals/${withdrawalId}/approve`);
      setMessage("Withdrawal approved successfully");
      await loadWithdrawals();
      await loadAuditLogs();
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to approve withdrawal"
      );
    } finally {
      setWithdrawActionLoadingId("");
    }
  }

  async function rejectWithdrawal(withdrawalId) {
    if (!withdrawalId) return;

    try {
      setWithdrawActionLoadingId(withdrawalId);
      await api.post(`/admin/withdrawals/${withdrawalId}/reject`);
      setMessage("Withdrawal rejected successfully");
      await loadWithdrawals();
      await loadAuditLogs();
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to reject withdrawal"
      );
    } finally {
      setWithdrawActionLoadingId("");
    }
  }

  async function approveKyc(userId) {
    try {
      await api.post("/admin/kyc/approve", { userId });
      setMessage("KYC approved successfully");
      loadKycs();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to approve KYC");
    }
  }

  async function rejectKyc(userId) {
    try {
      await api.post("/admin/kyc/reject", { userId });
      setMessage("KYC rejected successfully");
      loadKycs();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to reject KYC");
    }
  }

  async function suspendUser(userId) {
    try {
      await api.post("/admin/user/suspend", { userId });
      setMessage("User suspended successfully");
      loadUsers();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to suspend user");
    }
  }

  async function activateUser(userId) {
    try {
      await api.post("/admin/user/activate", { userId });
      setMessage("User activated successfully");
      loadUsers();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to activate user");
    }
  }

    async function updateUserRole(userId, role) {
    if (!userId || !role) return;

    try {
      setRoleUpdateLoadingUserId(userId);
      await api.post("/admin/user/set-role", { userId, role });
      setMessage("User role updated successfully");
      await loadUsers();
      await loadAuditLogs();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to update user role");
    } finally {
      setRoleUpdateLoadingUserId("");
    }
  }

  async function adjustWallet(e) {
    e.preventDefault();

    if (!adjustForm.identifier.trim()) {
      setMessage("Account number, phone, or user ID is required");
      return;
    }

    if (!adjustForm.amount || Number(adjustForm.amount) <= 0) {
      setMessage("Enter a valid amount");
      return;
    }

    if (!adjustForm.description.trim()) {
      setMessage("Description is required");
      return;
    }

    try {
      await api.post("/admin/wallet/adjust", {
        identifier: adjustForm.identifier.trim(),
        currency: adjustForm.currency,
        amount: Number(adjustForm.amount),
        type: adjustForm.type,
        description: adjustForm.description.trim(),
      });

      setMessage("Wallet adjusted successfully");
      setAdjustForm({
        identifier: "",
        currency: "USDT",
        amount: "",
        type: "credit",
        description: "",
      });
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to adjust wallet");
    }
  }

  async function loadWalletView(identifierOverride) {
    const identifier = String(identifierOverride || walletIdentifier).trim();

    if (!identifier) {
      setMessage("Enter phone, account number, or user ID");
      return;
    }

    setWalletViewLoading(true);
    setMessage("");

    try {
      const res = await api.get(
        `/admin/wallets/view?identifier=${encodeURIComponent(identifier)}`
      );
      setWalletViewData(res.data || null);
    } catch (err) {
      setWalletViewData(null);
      setMessage(err?.response?.data?.message || "Failed to load wallet view");
    } finally {
      setWalletViewLoading(false);
    }
  }

  function clearWalletView() {
    setWalletIdentifier("");
    setWalletViewData(null);
  }

  async function loadSystemSettings() {
    setSettingsLoading(true);
    setMessage("");

    try {
      const res = await api.get("/admin/settings");
      const s = res.data?.settings || {};

      setSettingsForm({
        dailyTransferLimit: String(s.dailyTransferLimit ?? ""),
        kycRequired: Boolean(s.kycRequired),
        maintenanceMode: Boolean(s.maintenanceMode),
        supportedCurrencies: Array.isArray(s.supportedCurrencies)
          ? s.supportedCurrencies.join(",")
          : "USDT,SSP,SDG,EGP,UGX",
      });
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load settings");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSystemSettings(e) {
    e.preventDefault();
    setSettingsLoading(true);
    setMessage("");

    try {
      const payload = {
        dailyTransferLimit: Number(settingsForm.dailyTransferLimit || 0),
        kycRequired: Boolean(settingsForm.kycRequired),
        maintenanceMode: Boolean(settingsForm.maintenanceMode),
        supportedCurrencies: settingsForm.supportedCurrencies
          .split(",")
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
      };

      await api.post("/admin/settings", payload);
      setMessage("Settings saved successfully");
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to save settings");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadCurrencySettings() {
    setCurrencySettingsLoading(true);
    setMessage("");

    try {
      const res = await api.get("/admin/settings/currencies");
      const rows = res.data?.currencies || [];
      setCurrencySettings(rows);

      if (rows.length > 0) {
        const first = rows[0];
        setSelectedCurrency(first.currency);
        setCurrencyForm({
          feePercent: String(first.feePercent ?? ""),
          flatFee: String(first.flatFee ?? ""),
          minTransfer: String(first.minTransfer ?? ""),
          maxTransfer: String(first.maxTransfer ?? ""),
          isEnabled: Boolean(first.isEnabled),
        });
      } else {
        setSelectedCurrency("");
        setCurrencyForm({
          feePercent: "",
          flatFee: "",
          minTransfer: "",
          maxTransfer: "",
          isEnabled: true,
        });
      }
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load currency settings"
      );
    } finally {
      setCurrencySettingsLoading(false);
    }
  }

  function handleSelectCurrency(currency) {
    const found = currencySettings.find((item) => item.currency === currency);
    setSelectedCurrency(currency);

    if (!found) {
      setCurrencyForm({
        feePercent: "",
        flatFee: "",
        minTransfer: "",
        maxTransfer: "",
        isEnabled: true,
      });
      return;
    }

    setCurrencyForm({
      feePercent: String(found.feePercent ?? ""),
      flatFee: String(found.flatFee ?? ""),
      minTransfer: String(found.minTransfer ?? ""),
      maxTransfer: String(found.maxTransfer ?? ""),
      isEnabled: Boolean(found.isEnabled),
    });
  }

  async function saveCurrencySettings(e) {
    e.preventDefault();

    if (!selectedCurrency) {
      setMessage("Select a currency first");
      return;
    }

    setCurrencySettingsLoading(true);
    setMessage("");

    try {
      const payload = {
        feePercent: Number(currencyForm.feePercent || 0),
        flatFee: Number(currencyForm.flatFee || 0),
        minTransfer: Number(currencyForm.minTransfer || 0),
        maxTransfer: Number(currencyForm.maxTransfer || 0),
        isEnabled: Boolean(currencyForm.isEnabled),
      };

      await api.post(
        `/admin/settings/currencies/${encodeURIComponent(selectedCurrency)}`,
        payload
      );

      setMessage(`${selectedCurrency} settings saved successfully`);
      await loadCurrencySettings();
      handleSelectCurrency(selectedCurrency);
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to save currency settings"
      );
    } finally {
      setCurrencySettingsLoading(false);
    }
  }

  async function downloadCsv(url, filename) {
    try {
      setMessage("");
      const res = await api.get(url, { responseType: "blob" });

      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
      const downloadUrl = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to export CSV");
    }
  }

  function exportUsersCsv() {
    const params = [];

    if (userRoleFilter !== "all") {
      params.push(`role=${encodeURIComponent(userRoleFilter)}`);
    }

    if (userSearch.trim()) {
      params.push(`search=${encodeURIComponent(userSearch.trim())}`);
    }

    const url =
      params.length > 0
        ? `/admin/export/users.csv?${params.join("&")}`
        : "/admin/export/users.csv";

    downloadCsv(url, `users-export-${Date.now()}.csv`);
  }

  function exportTransactionsCsv() {
    const params = [];

    if (txTypeFilter !== "all") {
      params.push(`type=${encodeURIComponent(txTypeFilter)}`);
    }

    if (txSearch.trim()) {
      params.push(`search=${encodeURIComponent(txSearch.trim())}`);
    }

    if (txReference.trim()) {
      params.push(`reference=${encodeURIComponent(txReference.trim())}`);
    }

    const url =
      params.length > 0
        ? `/admin/export/transactions.csv?${params.join("&")}`
        : "/admin/export/transactions.csv";

    downloadCsv(url, `transactions-export-${Date.now()}.csv`);
  }

  function exportKycCsv() {
    const params = [];

    if (kycStatusFilter !== "all") {
      params.push(`status=${encodeURIComponent(kycStatusFilter)}`);
    }

    const url =
      params.length > 0
        ? `/admin/export/kyc.csv?${params.join("&")}`
        : "/admin/export/kyc.csv";

    downloadCsv(url, `kyc-export-${Date.now()}.csv`);
  }

    useEffect(() => {
    loadMyPermissions();
    loadRoleMatrix();
  }, []);

  useEffect(() => {
        const sidebarOrder = [
      "dashboard",
      "kyc",
      "users",
      "transactions",
      "withdrawals",
      "auditLogs",
      "walletView",
      "wallet",
      "settings",
      "currencySettings",
      "roles",
    ];

    if (adminPermissions.length === 0) return;

    if (!canAccessPage(page)) {
      const firstAllowed = sidebarOrder.find((item) => canAccessPage(item));
      if (firstAllowed) {
        setPage(firstAllowed);
      }
    }
  }, [adminPermissions]);

    useEffect(() => {
    if (page === "dashboard") loadDashboardStats();
    if (page === "kyc") loadKycs();
    if (page === "users") loadUsers();
    if (page === "transactions") loadTransactions();
    if (page === "withdrawals") loadWithdrawals();
    if (page === "auditLogs") loadAuditLogs();
    if (page === "settings") loadSystemSettings();
    if (page === "currencySettings") loadCurrencySettings();
  }, [page, kycStatusFilter, userRoleFilter, txTypeFilter, withdrawStatusFilter]);
  const kycCounts = {
    all: kycs.length,
    pending: kycs.filter((k) => k.status === "pending").length,
    approved: kycs.filter((k) => k.status === "approved").length,
    rejected: kycs.filter((k) => k.status === "rejected").length,
  };

  function formatDate(value) {
    if (!value) return "-";

    const d = new Date(value);

    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderMoney(value) {
    const num = Number(value || 0);
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function openFile(path) {
  if (!path) return;

  const value = String(path).trim();

  if (value.startsWith("http://") || value.startsWith("https://")) {
    window.open(value, "_blank", "noopener,noreferrer");
    return;
  }

  setMessage("File URL is invalid. Backend must return a signed file URL.");
}

  function clearUserSearch() {
    setUserSearch("");
    setUserRoleFilter("all");
    loadUsers();
  }

  function clearTransactionSearch() {
    setTxSearch("");
    setTxReference("");
    setTxTypeFilter("all");
    loadTransactions();
  }

  function clearAuditSearch() {
    setAuditSearch("");
    setAuditActionFilter("all");
    loadAuditLogs();
  }

    function clearWithdrawSearch() {
    setWithdrawSearch("");
    setWithdrawStatusFilter("all");
    loadWithdrawals();
  }

    function handlePageChange(nextPage) {
    if (!canAccessPage(nextPage)) {
      setMessage("You do not have permission to access this page");
      return;
    }
    setPage(nextPage);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          minHeight: "100vh",
        }}
      >
        <aside
          style={{
            background: "#ffffff",
            borderRight: "1px solid #e2e8f0",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 24 }}>
            JeezPay Admin
          </div>

                    <div style={{ display: "grid", gap: 10 }}>
            {[
              ["dashboard", "Dashboard"],
              ["kyc", "KYC Review"],
              ["users", "Users"],
              ["transactions", "Transactions"],
              ["withdrawals", "Withdrawals"],
              ["auditLogs", "Audit Logs"],
              ["walletView", "Wallet View"],
              ["wallet", "Wallet Adjust"],
              ["settings", "System Settings"],
              ["currencySettings", "Currency Settings"],
              ["roles", "Roles & Permissions"],
            ]
              .filter(([key]) => canAccessPage(key))
              .map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handlePageChange(key)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    background: page === key ? "#0f172a" : "#f1f5f9",
                    color: page === key ? "#fff" : "#0f172a",
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              ))}
          </div>

          <div style={{ flex: 1 }} />

          <button
            onClick={onLogout}
            style={{
              width: "100%",
              marginTop: 24,
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: "#fee2e2",
              color: "#b91c1c",
              fontWeight: 700,
            }}
          >
            Logout
          </button>
        </aside>

        <main style={{ padding: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <div>
                            <h1 style={{ margin: 0, fontSize: 28 }}>
                {page === "dashboard" && "Dashboard"}
                {page === "kyc" && "KYC Review"}
                {page === "users" && "Users"}
                {page === "transactions" && "Transactions"}
                {page === "withdrawals" && "Withdrawals"}
                {page === "auditLogs" && "Audit Logs"}
                {page === "walletView" && "Wallet View"}
                {page === "wallet" && "Wallet Adjustment"}
                {page === "settings" && "System Settings"}
                {page === "currencySettings" && "Currency Settings"}
                {page === "roles" && "Roles & Permissions"}
              </h1>
              <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                Admin operations panel for JeezPay.
              </p>
                            {adminProfile ? (
                <p style={{ margin: "8px 0 0", color: "#0f172a", fontSize: 13 }}>
                  Signed in as {adminProfile.phone || adminProfile.id} • Role:{" "}
                  {adminProfile.role}
                </p>
              ) : null}
            </div>
          </div>

          {message ? (
            <div
              style={{
                background: "#eff6ff",
                color: "#1d4ed8",
                padding: 12,
                borderRadius: 12,
                marginBottom: 16,
              }}
            >
              {message}
            </div>
          ) : null}

          {page === "dashboard" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              <Card title="Total Users" value={String(stats.totalUsers)} />
              <Card title="Pending KYC" value={String(stats.pendingKyc)} />
              <Card
                title="Suspended Users"
                value={String(stats.suspendedUsers)}
              />
              <Card
                title="Transactions Today"
                value={String(stats.totalTransactionsToday)}
              />
            </div>
          )}

          {page === "kyc" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                {[
                  ["all", `All (${kycCounts.all})`],
                  ["pending", `Pending (${kycCounts.pending})`],
                  ["approved", `Approved (${kycCounts.approved})`],
                  ["rejected", `Rejected (${kycCounts.rejected})`],
                ].map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() => setKycStatusFilter(status)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        kycStatusFilter === status ? "#0f172a" : "#e2e8f0",
                      color: kycStatusFilter === status ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </button>
                ))}

                <button
                  onClick={exportKycCsv}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Export CSV
                </button>
              </div>

              {loading ? (
                <p>Loading...</p>
              ) : kycs.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No KYC submissions found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {kycs.map((item) => {
                    const status = String(item.status || "").toLowerCase();
                    const isPending = status === "pending";

                    return (
                      <div
                        key={item.user_id}
                        style={{
                          background: "#fff",
                          padding: 18,
                          borderRadius: 16,
                          boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 16,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>
                            {item.fullName || "-"}
                          </div>

                          <div
                            style={{
                              color: "#64748b",
                              marginTop: 6,
                              lineHeight: 1.6,
                              fontSize: 14,
                            }}
                          >
                            <div>Address: {item.address || "-"}</div>
                            <div>DOB: {item.dob || "-"}</div>
                            <div>Submitted: {formatDate(item.created_at)}</div>
                            <div>User ID: {item.user_id}</div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              marginTop: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => openFile(item.id_path)}
                              disabled={!item.id_path}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                                background: item.id_path ? "#fff" : "#f8fafc",
                                color: "#0f172a",
                                cursor: item.id_path
                                  ? "pointer"
                                  : "not-allowed",
                              }}
                            >
                              View ID
                            </button>

                            <button
                              onClick={() => openFile(item.selfie_path)}
                              disabled={!item.selfie_path}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                                background: item.selfie_path
                                  ? "#fff"
                                  : "#f8fafc",
                                color: "#0f172a",
                                cursor: item.selfie_path
                                  ? "pointer"
                                  : "not-allowed",
                              }}
                            >
                              View Selfie
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <StatusBadge value={item.status} />

                                                    {isPending &&
                            (hasPermission("kyc.approve") ||
                              hasPermission("kyc.reject")) && (
                              <>
                                {hasPermission("kyc.approve") && (
                                  <button
                                    onClick={() => approveKyc(item.user_id)}
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 10,
                                      border: "none",
                                      background: "#dcfce7",
                                      color: "#166534",
                                      cursor: "pointer",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Approve
                                  </button>
                                )}

                                {hasPermission("kyc.reject") && (
                                  <button
                                    onClick={() => rejectKyc(item.user_id)}
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 10,
                                      border: "none",
                                      background: "#fee2e2",
                                      color: "#b91c1c",
                                      cursor: "pointer",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Reject
                                  </button>
                                )}
                              </>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {page === "users" && (
  <div>
    <div
      style={{
        display: "flex",
        gap: 10,
        marginBottom: 16,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        placeholder="Search phone / account / user ID"
        value={userSearch}
        onChange={(e) => setUserSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") loadUsers();
        }}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #cbd5e1",
          background: "#fff",
          fontSize: 14,
          minWidth: 260,
        }}
      />

      <button
        onClick={loadUsers}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "none",
          background: "#0f172a",
          color: "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Search
      </button>

      <button
        onClick={clearUserSearch}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #cbd5e1",
          background: "#fff",
          color: "#0f172a",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Clear
      </button>

      <button
        onClick={exportUsersCsv}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #cbd5e1",
          background: "#fff",
          color: "#0f172a",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Export CSV
      </button>

      {[
        "all",
        "user",
        "agent",
        "merchant",
        "admin",
        "super_admin",
        "finance_admin",
        "kyc_officer",
        "support_agent",
        "auditor",
      ].map((role) => (
        <button
          key={role}
          onClick={() => setUserRoleFilter(role)}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            background: userRoleFilter === role ? "#0f172a" : "#e2e8f0",
            color: userRoleFilter === role ? "#fff" : "#0f172a",
            fontWeight: 600,
          }}
        >
          {role}
        </button>
      ))}
    </div>

    {loading ? (
      <p>Loading...</p>
    ) : users.length === 0 ? (
      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
          color: "#64748b",
        }}
      >
        No users found.
      </div>
    ) : (
      <div style={{ display: "grid", gap: 12 }}>
        {users
          .filter((item) => item.phone !== "COMPANY")
          .map((item) => {
            const isActive = item.is_active !== false;
            const kycStatus = item.kyc_profiles?.[0]?.status || "none";

            return (
              <div
                key={item.id}
                style={{
                  background: "#fff",
                  padding: 18,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {item.phone}
                  </div>
                  <div
                    style={{
                      color: "#64748b",
                      marginTop: 6,
                      lineHeight: 1.6,
                      fontSize: 14,
                    }}
                  >
                    <div>
                      Role: {item.role} • {item.account_type || "-"}
                    </div>
                    <div>
                      Phone verified: {item.phone_verified ? "yes" : "no"}
                    </div>
                    <div>KYC: {kycStatus}</div>
                    <div>User ID: {item.id}</div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <StatusBadge value={isActive ? "active" : "suspended"} />
                  <StatusBadge value={kycStatus} />

                  <button
                    onClick={() => loadUserDetails(item.phone || item.id)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      color: "#0f172a",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    View Details
                  </button>

                  {isActive && hasPermission("users.suspend") ? (
                    <button
                      onClick={() => suspendUser(item.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "none",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Suspend
                    </button>
                  ) : null}

                  {!isActive && hasPermission("users.activate") ? (
                    <button
                      onClick={() => activateUser(item.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "none",
                        background: "#dcfce7",
                        color: "#166534",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Activate
                    </button>
                  ) : null}

                  {hasPermission("users.role.update") && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <select
                        value={userRoleDrafts[item.id] ?? item.role}
                        onChange={(e) =>
                          setUserRoleDrafts((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          fontSize: 14,
                        }}
                      >
                        {manageableRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() =>
                          updateUserRole(
                            item.id,
                            userRoleDrafts[item.id] ?? item.role
                          )
                        }
                        disabled={
                          roleUpdateLoadingUserId === item.id ||
                          (userRoleDrafts[item.id] ?? item.role) === item.role
                        }
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "none",
                          background: "#0f172a",
                          color: "#fff",
                          cursor:
                            roleUpdateLoadingUserId === item.id
                              ? "not-allowed"
                              : "pointer",
                          fontWeight: 600,
                          opacity:
                            (userRoleDrafts[item.id] ?? item.role) === item.role
                              ? 0.6
                              : 1,
                        }}
                      >
                        {roleUpdateLoadingUserId === item.id
                          ? "Saving..."
                          : "Update Role"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    )}
  </div>
)}

          {page === "transactions" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  placeholder="Search phone / account / user ID"
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadTransactions();
                  }}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: 14,
                    minWidth: 240,
                  }}
                />

                <input
                  placeholder="Search reference"
                  value={txReference}
                  onChange={(e) => setTxReference(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadTransactions();
                  }}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: 14,
                    minWidth: 180,
                  }}
                />

                <button
                  onClick={loadTransactions}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "none",
                    background: "#0f172a",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Search
                </button>

                <button
                  onClick={clearTransactionSearch}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>

                <button
                  onClick={exportTransactionsCsv}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Export CSV
                </button>

                {["all", "credit", "debit"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setTxTypeFilter(type)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        txTypeFilter === type ? "#0f172a" : "#e2e8f0",
                      color: txTypeFilter === type ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {loading ? (
                <p>Loading...</p>
              ) : transactions.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No transactions found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {transactions.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        background: "#fff",
                        padding: 18,
                        borderRadius: 16,
                        boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>
                          {item.description || "No description"}
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: "#94a3b8",
                            marginTop: 4,
                          }}
                        >
                          Ref #{item.reference}
                        </div>

                        <div
                          style={{
                            color: "#64748b",
                            marginTop: 6,
                            lineHeight: 1.6,
                            fontSize: 14,
                          }}
                        >
                          <div>Reference: {item.reference || "-"}</div>
                          <div>Date: {formatDate(item.created_at)}</div>
                          <div>Currency: {item.wallets?.currency || "-"}</div>
                          <div>User ID: {item.wallets?.user_id || "-"}</div>
                          <div>Wallet ID: {item.wallet_id || "-"}</div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <StatusBadge value={item.type} />
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 18,
                            color:
                              item.type === "credit" ? "#166534" : "#b91c1c",
                          }}
                        >
                          {item.type === "credit" ? "+" : "-"}
                          {item.amount}
                          {item.wallets?.currency}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {page === "auditLogs" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  placeholder="Search phone / target / target id"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadAuditLogs();
                  }}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: 14,
                    minWidth: 260,
                  }}
                />

                <button
                  onClick={loadAuditLogs}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "none",
                    background: "#0f172a",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Search
                </button>

                <button
                  onClick={clearAuditSearch}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>

                {[
                  ["all", "All"],
                  ["KYC_APPROVED", "KYC Approved"],
                  ["KYC_REJECTED", "KYC Rejected"],
                  ["USER_SUSPENDED", "User Suspended"],
                  ["USER_ACTIVATED", "User Activated"],
                  ["WALLET_ADJUSTED", "Wallet Adjusted"],
                  ["USER_ROLE_CHANGED", "Role Changed"],
                  ["SYSTEM_SETTINGS_UPDATED", "System Settings"],
                  ["CURRENCY_SETTINGS_UPDATED", "Currency Settings"],
                ].map(([action, label]) => (
                  <button
                    key={action}
                    onClick={() => setAuditActionFilter(action)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        auditActionFilter === action ? "#0f172a" : "#e2e8f0",
                      color: auditActionFilter === action ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {loading ? (
                <p>Loading...</p>
              ) : auditLogs.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No audit logs found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {auditLogs.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        background: "#fff",
                        padding: 18,
                        borderRadius: 16,
                        boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 16 }}>
                          {item.action || "-"}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 13 }}>
                          {formatDate(item.created_at)}
                        </div>
                      </div>

                      <div
                        style={{
                          color: "#475569",
                          fontSize: 14,
                          lineHeight: 1.7,
                        }}
                      >
                        <div>
                          <strong>Admin:</strong>{" "}
                          {item.admin_phone || item.admin_id || "-"}
                        </div>
                        <div>
                          <strong>Target Type:</strong> {item.target_type || "-"}
                        </div>
                        <div>
                          <strong>Target:</strong>{" "}
                          {item.target_display || item.target_id || "-"}
                        </div>
                        <div>
                          <strong>IP:</strong> {item.ip_address || "-"}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 12,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              marginBottom: 8,
                              color: "#334155",
                            }}
                          >
                            Old Value
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontSize: 12,
                              color: "#475569",
                              fontFamily: "monospace",
                            }}
                          >
                            {JSON.stringify(item.old_value || {}, null, 2)}
                          </pre>
                        </div>

                        <div
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 12,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              marginBottom: 8,
                              color: "#334155",
                            }}
                          >
                            New Value
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontSize: 12,
                              color: "#475569",
                              fontFamily: "monospace",
                            }}
                          >
                            {JSON.stringify(item.new_value || {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

                    {page === "withdrawals" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  placeholder="Search user ID / wallet ID / destination"
                  value={withdrawSearch}
                  onChange={(e) => setWithdrawSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadWithdrawals();
                  }}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: 14,
                    minWidth: 280,
                  }}
                />

                <button
                  onClick={loadWithdrawals}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "none",
                    background: "#0f172a",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Search
                </button>

                <button
                  onClick={clearWithdrawSearch}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>

                {["all", "pending", "approved", "rejected"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setWithdrawStatusFilter(status)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        withdrawStatusFilter === status ? "#0f172a" : "#e2e8f0",
                      color:
                        withdrawStatusFilter === status ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {status}
                  </button>
                ))}
              </div>

              {withdrawalsLoading ? (
                <p>Loading...</p>
              ) : withdrawals.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No withdrawal requests found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {withdrawals.map((item) => {
                    const isPending =
                      String(item.status || "").toLowerCase() === "pending";

                    return (
                      <div
                        key={item.id}
                        style={{
                          background: "#fff",
                          padding: 18,
                          borderRadius: 16,
                          boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 16,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>
                            {renderMoney(item.amount)} {item.currency}
                          </div>

                          <div
                            style={{
                              color: "#64748b",
                              marginTop: 6,
                              lineHeight: 1.7,
                              fontSize: 14,
                            }}
                          >
                            <div>User ID: {item.user_id || "-"}</div>
                            <div>Wallet ID: {item.wallet_id || "-"}</div>
                            <div>Method: {item.method || "-"}</div>
                            <div>Destination: {item.destination || "-"}</div>
                            <div>TX Hash: {item.tx_hash || "-"}</div>
                            <div>Admin ID: {item.admin_id || "-"}</div>
                            <div>Created: {formatDate(item.created_at)}</div>
                            <div>
                              Processed: {formatDate(item.processed_at)}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          <StatusBadge value={item.status} />

                          {isPending && hasPermission("wallets.adjust") && (
                            <>
                              <button
                                onClick={() => approveWithdrawal(item.id)}
                                disabled={withdrawActionLoadingId === item.id}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#dcfce7",
                                  color: "#166534",
                                  cursor:
                                    withdrawActionLoadingId === item.id
                                      ? "not-allowed"
                                      : "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                {withdrawActionLoadingId === item.id
                                  ? "Processing..."
                                  : "Approve"}
                              </button>

                              <button
                                onClick={() => rejectWithdrawal(item.id)}
                                disabled={withdrawActionLoadingId === item.id}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#fee2e2",
                                  color: "#b91c1c",
                                  cursor:
                                    withdrawActionLoadingId === item.id
                                      ? "not-allowed"
                                      : "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                {withdrawActionLoadingId === item.id
                                  ? "Processing..."
                                  : "Reject"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {page === "walletView" && (
            <div style={{ display: "grid", gap: 16, maxWidth: 920 }}>
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                    color: "#0f172a",
                  }}
                >
                  Wallet Balance View
                </div>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 14,
                    marginBottom: 18,
                    lineHeight: 1.6,
                  }}
                >
                  View all wallets and balances for a user by phone, account
                  number, or user ID.
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <input
                    placeholder="Enter phone / account / user ID"
                    value={walletIdentifier}
                    onChange={(e) => setWalletIdentifier(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadWalletView();
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid #dbe2ea",
                      background: "#f8fafc",
                      fontSize: 14,
                      minWidth: 300,
                    }}
                  />

                  <button
                    onClick={() => loadWalletView()}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: "none",
                      background: "#0f172a",
                      color: "#fff",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Search
                  </button>

                  <button
                    onClick={clearWalletView}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      color: "#334155",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {walletViewLoading ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 20,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  }}
                >
                  Loading wallet view...
                </div>
              ) : walletViewData ? (
                <>
                  <div
                    style={{
                      background: "#fff",
                      padding: 20,
                      borderRadius: 16,
                      boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        marginBottom: 12,
                      }}
                    >
                      User
                    </div>
                    <div
                      style={{ color: "#475569", lineHeight: 1.8, fontSize: 14 }}
                    >
                      <div>
                        <strong>Phone:</strong>{" "}
                        {walletViewData.user?.phone || "-"}
                      </div>
                      <div>
                        <strong>Role:</strong> {walletViewData.user?.role || "-"}
                      </div>
                      <div>
                        <strong>Status:</strong>{" "}
                        {walletViewData.user?.is_active ? "active" : "suspended"}
                      </div>
                      <div>
                        <strong>Wallet Account:</strong>{" "}
                        {walletViewData.user?.wallet_account_number || "-"}
                      </div>
                      <div>
                        <strong>User ID:</strong> {walletViewData.user?.id || "-"}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 16,
                    }}
                  >
                    <Card
                      title="Wallet Count"
                      value={String(walletViewData.summary?.wallet_count || 0)}
                    />
                    <Card
                      title="Total Current"
                      value={renderMoney(
                        walletViewData.summary?.total_current_balance || 0
                      )}
                    />
                    <Card
                      title="Total Available"
                      value={renderMoney(
                        walletViewData.summary?.total_available_balance || 0
                      )}
                    />
                    <Card
                      title="Total Frozen"
                      value={renderMoney(
                        walletViewData.summary?.total_frozen_balance || 0
                      )}
                    />
                  </div>

                  <div
                    style={{
                      background: "#fff",
                      padding: 20,
                      borderRadius: 16,
                      boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        marginBottom: 12,
                      }}
                    >
                      Wallets
                    </div>

                    {walletViewData.wallets?.length ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        {walletViewData.wallets.map((wallet) => (
                          <div
                            key={wallet.id}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: 12,
                              padding: 14,
                              background: "#f8fafc",
                            }}
                          >
                            <div style={{ fontWeight: 700, marginBottom: 8 }}>
                              {wallet.currency}
                            </div>
                            <div
                              style={{
                                color: "#475569",
                                lineHeight: 1.8,
                                fontSize: 14,
                              }}
                            >
                              <div>
                                Current Balance:{" "}
                                {renderMoney(wallet.current_balance)}
                              </div>
                              <div>
                                Available Balance:{" "}
                                {renderMoney(wallet.available_balance)}
                              </div>
                              <div>
                                Frozen Balance:{" "}
                                {renderMoney(wallet.frozen_balance)}
                              </div>
                              <div>
                                Pending Withdrawals:{" "}
                                {renderMoney(wallet.pending_withdrawals)}
                              </div>
                              <div>Wallet ID: {wallet.id}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: "#64748b" }}>No wallets found.</div>
                    )}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    background: "#fff",
                    padding: 20,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  Search for a user to view wallet balances.
                </div>
              )}
            </div>
          )}

          {page === "settings" && (
            <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                    color: "#0f172a",
                  }}
                >
                  Global System Settings
                </div>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 14,
                    marginBottom: 18,
                    lineHeight: 1.6,
                  }}
                >
                  Configure global toggles and limits only. Currency fees are
                  managed separately in Currency Settings.
                </div>

                {settingsLoading ? (
                  <p>Loading settings...</p>
                ) : (
                  <form
                    onSubmit={saveSystemSettings}
                    style={{
                      display: "grid",
                      gap: 14,
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      <label
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        Daily Transfer Limit
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={settingsForm.dailyTransferLimit}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            dailyTransferLimit: e.target.value,
                          })
                        }
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid #dbe2ea",
                          background: "#f8fafc",
                          fontSize: 14,
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <label
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        Supported Currencies
                      </label>
                      <input
                        value={settingsForm.supportedCurrencies}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            supportedCurrencies: e.target.value,
                          })
                        }
                        placeholder="USDT,SSP,SDG,EGP,UGX"
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid #dbe2ea",
                          background: "#f8fafc",
                          fontSize: 14,
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 20,
                        flexWrap: "wrap",
                        marginTop: 6,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={settingsForm.kycRequired}
                          onChange={(e) =>
                            setSettingsForm({
                              ...settingsForm,
                              kycRequired: e.target.checked,
                            })
                          }
                        />
                        KYC Required
                      </label>

                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={settingsForm.maintenanceMode}
                          onChange={(e) =>
                            setSettingsForm({
                              ...settingsForm,
                              maintenanceMode: e.target.checked,
                            })
                          }
                        />
                        Maintenance Mode
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                      <button
                        type="submit"
                        style={{
                          padding: "14px 18px",
                          borderRadius: 12,
                          border: "none",
                          background: "#0f172a",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: 700,
                          minWidth: 160,
                        }}
                      >
                        Save Settings
                      </button>

                      <button
                        type="button"
                        onClick={loadSystemSettings}
                        style={{
                          padding: "14px 18px",
                          borderRadius: 12,
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          color: "#334155",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Reload
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {page === "currencySettings" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                    color: "#0f172a",
                  }}
                >
                  Currency Settings
                </div>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 14,
                    marginBottom: 18,
                    lineHeight: 1.6,
                  }}
                >
                  Configure fee percent, flat fee, transfer limits, and enabled
                  status for each currency.
                </div>

                {currencySettingsLoading ? (
                  <p>Loading currency settings...</p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "340px 1fr",
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      {currencySettings.length === 0 ? (
                        <div
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 16,
                            color: "#64748b",
                          }}
                        >
                          No currency settings found.
                        </div>
                      ) : (
                        currencySettings.map((item) => (
                          <button
                            key={item.currency}
                            onClick={() => handleSelectCurrency(item.currency)}
                            style={{
                              textAlign: "left",
                              padding: 14,
                              borderRadius: 12,
                              border:
                                selectedCurrency === item.currency
                                  ? "2px solid #0f172a"
                                  : "1px solid #e2e8f0",
                              background:
                                selectedCurrency === item.currency
                                  ? "#f8fafc"
                                  : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 12,
                              }}
                            >
                              <div style={{ fontWeight: 700, color: "#0f172a" }}>
                                {item.currency}
                              </div>
                              <StatusBadge
                                value={item.isEnabled ? "enabled" : "disabled"}
                              />
                            </div>

                            <div
                              style={{
                                fontSize: 13,
                                color: "#64748b",
                                marginTop: 8,
                                lineHeight: 1.6,
                              }}
                            >
                              <div>Fee %: {renderMoney(item.feePercent)}</div>
                              <div>Flat Fee: {renderMoney(item.flatFee)}</div>
                              <div>
                                Min / Max: {renderMoney(item.minTransfer)} /{" "}
                                {renderMoney(item.maxTransfer)}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>

                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 16,
                        padding: 20,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          marginBottom: 12,
                          color: "#0f172a",
                        }}
                      >
                        {selectedCurrency
                          ? `${selectedCurrency} Configuration`
                          : "Select a Currency"}
                      </div>

                      {!selectedCurrency ? (
                        <div style={{ color: "#64748b" }}>
                          Choose a currency from the list to edit its settings.
                        </div>
                      ) : (
                        <form
                          onSubmit={saveCurrencySettings}
                          style={{ display: "grid", gap: 14 }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 14,
                            }}
                          >
                            <div style={{ display: "grid", gap: 8 }}>
                              <label
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#334155",
                                }}
                              >
                                Fee Percent
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={currencyForm.feePercent}
                                onChange={(e) =>
                                  setCurrencyForm({
                                    ...currencyForm,
                                    feePercent: e.target.value,
                                  })
                                }
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  border: "1px solid #dbe2ea",
                                  background: "#f8fafc",
                                  fontSize: 14,
                                }}
                              />
                            </div>

                            <div style={{ display: "grid", gap: 8 }}>
                              <label
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#334155",
                                }}
                              >
                                Flat Fee
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={currencyForm.flatFee}
                                onChange={(e) =>
                                  setCurrencyForm({
                                    ...currencyForm,
                                    flatFee: e.target.value,
                                  })
                                }
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  border: "1px solid #dbe2ea",
                                  background: "#f8fafc",
                                  fontSize: 14,
                                }}
                              />
                            </div>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 14,
                            }}
                          >
                            <div style={{ display: "grid", gap: 8 }}>
                              <label
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#334155",
                                }}
                              >
                                Minimum Transfer
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={currencyForm.minTransfer}
                                onChange={(e) =>
                                  setCurrencyForm({
                                    ...currencyForm,
                                    minTransfer: e.target.value,
                                  })
                                }
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  border: "1px solid #dbe2ea",
                                  background: "#f8fafc",
                                  fontSize: 14,
                                }}
                              />
                            </div>

                            <div style={{ display: "grid", gap: 8 }}>
                              <label
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#334155",
                                }}
                              >
                                Maximum Transfer
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={currencyForm.maxTransfer}
                                onChange={(e) =>
                                  setCurrencyForm({
                                    ...currencyForm,
                                    maxTransfer: e.target.value,
                                  })
                                }
                                style={{
                                  padding: 12,
                                  borderRadius: 12,
                                  border: "1px solid #dbe2ea",
                                  background: "#f8fafc",
                                  fontSize: 14,
                                }}
                              />
                            </div>
                          </div>

                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              fontWeight: 600,
                              color: "#334155",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={currencyForm.isEnabled}
                              onChange={(e) =>
                                setCurrencyForm({
                                  ...currencyForm,
                                  isEnabled: e.target.checked,
                                })
                              }
                            />
                            Currency Enabled
                          </label>

                          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                            <button
                              type="submit"
                              style={{
                                padding: "14px 18px",
                                borderRadius: 12,
                                border: "none",
                                background: "#0f172a",
                                color: "#fff",
                                cursor: "pointer",
                                fontWeight: 700,
                                minWidth: 160,
                              }}
                            >
                              Save Currency
                            </button>

                            <button
                              type="button"
                              onClick={loadCurrencySettings}
                              style={{
                                padding: "14px 18px",
                                borderRadius: 12,
                                border: "1px solid #cbd5e1",
                                background: "#fff",
                                color: "#334155",
                                cursor: "pointer",
                                fontWeight: 600,
                              }}
                            >
                              Reload List
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

                    {page === "roles" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                    color: "#0f172a",
                  }}
                >
                  Role Management
                </div>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 14,
                    marginBottom: 18,
                    lineHeight: 1.6,
                  }}
                >
                  Assign roles from the Users page. This page shows the current
                  permission matrix used by the admin dashboard.
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                  }}
                >
                  {Object.keys(roleMatrix).length === 0 ? (
                    <div style={{ color: "#64748b" }}>
                      No role permissions loaded.
                    </div>
                  ) : (
                    Object.entries(roleMatrix).map(([role, permissions]) => (
                      <div
                        key={role}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          padding: 14,
                          background: "#f8fafc",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 10,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>
                            {role}
                          </div>
                          <div style={{ color: "#64748b", fontSize: 13 }}>
                            {permissions.includes("*")
                              ? "Full access"
                              : `${permissions.length} permissions`}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          {permissions.includes("*") ? (
                            <span
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                background: "#dbeafe",
                                color: "#1d4ed8",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              *
                            </span>
                          ) : permissions.length === 0 ? (
                            <span style={{ color: "#64748b", fontSize: 13 }}>
                              No permissions
                            </span>
                          ) : (
                            permissions.map((permission) => (
                              <span
                                key={permission}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  background: "#e2e8f0",
                                  color: "#334155",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {permission}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  overflowX: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 14,
                    color: "#0f172a",
                  }}
                >
                  Permission Matrix
                </div>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 900,
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 12,
                          borderBottom: "1px solid #e2e8f0",
                          color: "#334155",
                          fontSize: 13,
                        }}
                      >
                        Permission
                      </th>
                      {Object.keys(roleMatrix).map((role) => (
                        <th
                          key={role}
                          style={{
                            textAlign: "center",
                            padding: 12,
                            borderBottom: "1px solid #e2e8f0",
                            color: "#334155",
                            fontSize: 13,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {role}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allPermissions.map((permission) => (
                      <tr key={permission}>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #f1f5f9",
                            fontWeight: 600,
                            color: "#0f172a",
                          }}
                        >
                          {permission}
                        </td>

                        {Object.keys(roleMatrix).map((role) => {
                          const rolePermissions = roleMatrix[role] || [];
                          const allowed =
                            rolePermissions.includes("*") ||
                            rolePermissions.includes(permission);

                          return (
                            <td
                              key={`${permission}-${role}`}
                              style={{
                                padding: 12,
                                textAlign: "center",
                                borderBottom: "1px solid #f1f5f9",
                                color: allowed ? "#166534" : "#94a3b8",
                                fontWeight: 700,
                              }}
                            >
                              {allowed ? "✓" : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === "wallet" && (
            <div
              style={{
                display: "grid",
                gap: 16,
                maxWidth: 760,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                    color: "#0f172a",
                  }}
                >
                  Manual Wallet Adjustment
                </div>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 14,
                    marginBottom: 18,
                    lineHeight: 1.6,
                  }}
                >
                  Credit or debit a user wallet manually. Use the user ID from
                  the Users page.
                </div>

                <form
                  onSubmit={adjustWallet}
                  style={{
                    display: "grid",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "grid", gap: 8 }}>
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#334155",
                      }}
                    >
                      Account Number / Phone / User ID
                    </label>
                    <input
                      placeholder="Enter account number, phone, or user UUID"
                      value={adjustForm.identifier}
                      onChange={(e) =>
                        setAdjustForm({
                          ...adjustForm,
                          identifier: e.target.value,
                        })
                      }
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: "1px solid #dbe2ea",
                        background: "#f8fafc",
                        fontSize: 14,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 14,
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      <label
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        Currency
                      </label>
                      <select
                        value={adjustForm.currency}
                        onChange={(e) =>
                          setAdjustForm({
                            ...adjustForm,
                            currency: e.target.value.toUpperCase(),
                          })
                        }
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid #dbe2ea",
                          background: "#f8fafc",
                          fontSize: 14,
                        }}
                      >
                        <option value="USDT">USDT</option>
                        <option value="SSP">SSP</option>
                        <option value="SDG">SDG</option>
                        <option value="EGP">EGP</option>
                        <option value="UGX">UGX</option>
                      </select>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <label
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        Type
                      </label>
                      <select
                        value={adjustForm.type}
                        onChange={(e) =>
                          setAdjustForm({
                            ...adjustForm,
                            type: e.target.value,
                          })
                        }
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid #dbe2ea",
                          background: "#f8fafc",
                          fontSize: 14,
                        }}
                      >
                        <option value="credit">Credit</option>
                        <option value="debit">Debit</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#334155",
                      }}
                    >
                      Amount
                    </label>
                    <input
                      placeholder="Enter amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={adjustForm.amount}
                      onChange={(e) =>
                        setAdjustForm({
                          ...adjustForm,
                          amount: e.target.value,
                        })
                      }
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: "1px solid #dbe2ea",
                        background: "#f8fafc",
                        fontSize: 14,
                      }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#334155",
                      }}
                    >
                      Reason / Description
                    </label>
                    <textarea
                      placeholder="Why are you making this adjustment?"
                      value={adjustForm.description}
                      onChange={(e) =>
                        setAdjustForm({
                          ...adjustForm,
                          description: e.target.value,
                        })
                      }
                      rows={4}
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: "1px solid #dbe2ea",
                        background: "#f8fafc",
                        fontSize: 14,
                        resize: "vertical",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      marginTop: 4,
                    }}
                  >
                    <button
                      type="submit"
                      style={{
                        padding: "14px 18px",
                        borderRadius: 12,
                        border: "none",
                        background:
                          adjustForm.type === "credit" ? "#166534" : "#b91c1c",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 700,
                        minWidth: 180,
                      }}
                    >
                      {adjustForm.type === "credit"
                        ? "Submit Credit"
                        : "Submit Debit"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setAdjustForm({
                          identifier: "",
                          currency: "USDT",
                          amount: "",
                          type: "credit",
                          description: "",
                        })
                      }
                      style={{
                        padding: "14px 18px",
                        borderRadius: 12,
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        color: "#334155",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </form>
              </div>

              <div
                style={{
                  background: "#fff",
                  padding: 18,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    color: "#0f172a",
                    marginBottom: 8,
                  }}
                >
                  Notes
                </div>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 14,
                    lineHeight: 1.7,
                  }}
                >
                  <div>• Credit adds funds to the selected wallet.</div>
                  <div>
                    • Debit removes funds and will fail if balance is
                    insufficient.
                  </div>
                  <div>• Always include a clear reason for audit purposes.</div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {showUserDetails && (
        <div
          onClick={() => setShowUserDetails(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(620px, 100%)",
              height: "100%",
              background: "#f8fafc",
              padding: 20,
              overflowY: "auto",
              boxShadow: "-10px 0 30px rgba(15, 23, 42, 0.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 24 }}>User Details</h2>
                <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                  Full admin view for selected user
                </p>
              </div>

              <button
                onClick={() => setShowUserDetails(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>

            {userDetailsLoading ? (
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                Loading user details...
              </div>
            ) : !selectedUserDetails ? (
              <div
                style={{
                  background: "#fff",
                  padding: 20,
                  borderRadius: 16,
                  boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                }}
              >
                No user details found.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                <div
                  style={{
                    background: "#fff",
                    padding: 18,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  }}
                >
                  <div
                    style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}
                  >
                    Profile
                  </div>

                  <div
                    style={{ color: "#475569", lineHeight: 1.8, fontSize: 14 }}
                  >
                    <div>
                      <strong>Phone:</strong>{" "}
                      {selectedUserDetails.user?.phone || "-"}
                    </div>
                    <div>
  <strong>Full Name:</strong> {selectedUserDetails.user?.fullName || "-"}
</div>
                    <div>
                      <strong>Role:</strong>{" "}
                      {selectedUserDetails.user?.role || "-"}
                    </div>
                    <div>
                      <strong>Account Type:</strong>{" "}
                      {selectedUserDetails.user?.account_type || "-"}
                    </div>
                    <div>
                      <strong>Phone Verified:</strong>{" "}
                      {selectedUserDetails.user?.phone_verified ? "yes" : "no"}
                    </div>
                    <div>
                      <strong>Status:</strong>{" "}
                      {selectedUserDetails.user?.is_active
                        ? "active"
                        : "suspended"}
                    </div>
                    <div>
                      <strong>Wallet Account:</strong>{" "}
                      {selectedUserDetails.user?.wallet_account_number || "-"}
                    </div>
                    <div>
                      <strong>Created:</strong>{" "}
                      {formatDate(selectedUserDetails.user?.created_at)}
                    </div>
                    <div>
                      <strong>User ID:</strong>{" "}
                      {selectedUserDetails.user?.id || "-"}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "#fff",
                    padding: 18,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  }}
                >
                  <div
                    style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}
                  >
                    Wallets
                  </div>

                  {selectedUserDetails.wallets?.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {selectedUserDetails.wallets.map((wallet) => (
                        <div
                          key={wallet.id}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 14,
                            background: "#f8fafc",
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>
                            {wallet.currency}
                          </div>
                          <div
                            style={{
                              color: "#475569",
                              fontSize: 14,
                              lineHeight: 1.7,
                            }}
                          >
                            <div>
                              Current: {renderMoney(wallet.current_balance)}
                            </div>
                            <div>
                              Available: {renderMoney(wallet.available_balance)}
                            </div>
                            <div>
                              Frozen: {renderMoney(wallet.frozen_balance)}
                            </div>
                            <div>
                              Pending Withdrawals:{" "}
                              {renderMoney(wallet.pending_withdrawals)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "#64748b" }}>No wallets found.</div>
                  )}
                </div>

                <div
                  style={{
                    background: "#fff",
                    padding: 18,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  }}
                >
                  <div
                    style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}
                  >
                    KYC
                  </div>

                  {selectedUserDetails.kyc ? (
                    <div
                      style={{
                        color: "#475569",
                        lineHeight: 1.8,
                        fontSize: 14,
                      }}
                    >
                      <div>
                        <strong>Full Name:</strong>{" "}
                        {selectedUserDetails.kyc.fullName || "-"}
                      </div>
                      <div>
                        <strong>Status:</strong>{" "}
                        <StatusBadge
                          value={selectedUserDetails.kyc.status || "none"}
                        />
                      </div>
                      <div>
                        <strong>DOB:</strong>{" "}
                        {selectedUserDetails.kyc.dob || "-"}
                      </div>
                      <div>
                        <strong>Address:</strong>{" "}
                        {selectedUserDetails.kyc.address || "-"}
                      </div>
                      <div>
                        <strong>Submitted:</strong>{" "}
                        {formatDate(selectedUserDetails.kyc.created_at)}
                      </div>
                      <div>
                        <strong>Updated:</strong>{" "}
                        {formatDate(selectedUserDetails.kyc.updated_at)}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          marginTop: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          onClick={() =>
                            openFile(selectedUserDetails.kyc.id_path)
                          }
                          disabled={!selectedUserDetails.kyc.id_path}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            cursor: selectedUserDetails.kyc.id_path
                              ? "pointer"
                              : "not-allowed",
                          }}
                        >
                          View ID
                        </button>

                        <button
                          onClick={() =>
                            openFile(selectedUserDetails.kyc.selfie_path)
                          }
                          disabled={!selectedUserDetails.kyc.selfie_path}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            cursor: selectedUserDetails.kyc.selfie_path
                              ? "pointer"
                              : "not-allowed",
                          }}
                        >
                          View Selfie
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: "#64748b" }}>
                      No KYC profile found.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "#fff",
                    padding: 18,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                  }}
                >
                  <div
                    style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}
                  >
                    Recent Transactions
                  </div>

                  {selectedUserDetails.recentTransactions?.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {selectedUserDetails.recentTransactions.map((tx) => (
                        <div
                          key={tx.id}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 14,
                            background: "#f8fafc",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700 }}>
                              {tx.description || "No description"}
                            </div>
                            <div
                              style={{
                                color: "#64748b",
                                fontSize: 13,
                                marginTop: 4,
                              }}
                            >
                              Ref: {tx.reference || "-"}
                            </div>
                            <div
                              style={{
                                color: "#64748b",
                                fontSize: 13,
                                marginTop: 4,
                              }}
                            >
                              {formatDate(tx.created_at)}
                            </div>
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <StatusBadge value={tx.type} />
                            <div
                              style={{
                                fontWeight: 700,
                                marginTop: 8,
                                color:
                                  tx.type === "credit" ? "#166534" : "#b91c1c",
                              }}
                            >
                              {tx.type === "credit" ? "+" : "-"}
                              {renderMoney(tx.amount)} {tx.currency || ""}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "#64748b" }}>
                      No recent transactions found.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");

  function handleLogout() {
    localStorage.removeItem("admin_token");
    setToken("");
  }

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  return <AppShell onLogout={handleLogout} />;
}