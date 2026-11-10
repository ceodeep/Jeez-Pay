export const PAGE_PERMISSIONS = {
  dashboard: "dashboard.view",
  kyc: "kyc.view",
  withdrawals: "crypto.withdrawals.view",
  serviceRequests: "transactions.view",
  transactions: "transactions.view",
  users: "users.view",
  walletView: "wallets.view",
  companyWallet: "wallets.view",
  walletAdjust: "wallets.adjust",
  treasury: "wallets.adjust",
  exchangeRates: "currency_settings.view",
  currencies: "currency_settings.view",
  referral: "settings.view",
  roles: "users.role.update",
  settings: "settings.view",
  auditLogs: "audit_logs.view",
  scannerLogs: "wallets.adjust",
};

export const NAV = [
  {
    label: "Operations",
    items: [
      { key: "dashboard", label: "Today", badge: "queue" },
      { key: "kyc", label: "KYC review", badge: "kyc" },
      { key: "withdrawals", label: "Withdrawals", badge: "withdrawals" },
      { key: "serviceRequests", label: "Service requests", badge: "requests" },
      { key: "scannerLogs", label: "Scanner logs" },
    ],
  },
  {
    label: "Money",
    items: [
      { key: "transactions", label: "Transactions" },
      { key: "walletView", label: "Wallet view" },
      { key: "companyWallet", label: "Company wallet" },
      { key: "walletAdjust", label: "Adjust wallet" },
      { key: "treasury", label: "Treasury" },
      { key: "exchangeRates", label: "Exchange rates" },
      { key: "currencies", label: "Currency settings" },
    ],
  },
  {
    label: "People",
    items: [
      { key: "users", label: "Users" },
      { key: "roles", label: "Roles & access" },
      { key: "referral", label: "Referral rewards" },
    ],
  },
  {
    label: "System",
    items: [
      { key: "auditLogs", label: "Audit log" },
      { key: "settings", label: "Settings" },
    ],
  },
];

export const PAGE_TITLES = {
  dashboard: "Today",
  kyc: "KYC review",
  withdrawals: "Withdrawals",
  serviceRequests: "Service requests",
  scannerLogs: "Scanner logs",
  transactions: "Transactions",
  walletView: "Wallet view",
  companyWallet: "Company wallet",
  walletAdjust: "Adjust wallet",
  treasury: "Treasury",
  exchangeRates: "Exchange rates",
  currencies: "Currency settings",
  users: "Users",
  roles: "Roles & access",
  referral: "Referral rewards",
  auditLogs: "Audit log",
  settings: "Settings",
};

export const MOBILE_TABS = ["dashboard", "kyc", "withdrawals", "serviceRequests"];

export function allowedPages(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  const isSuper = list.includes("*");
  const set = new Set();
  Object.entries(PAGE_PERMISSIONS).forEach(([page, perm]) => {
    if (isSuper || list.includes(perm)) set.add(page);
  });
  return set;
}
