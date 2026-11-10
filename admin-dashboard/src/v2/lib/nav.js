export const PAGE_PERMISSIONS = {
  dashboard: "dashboard.view",
  kyc: "kyc.view",
  withdrawals: "crypto.withdrawals.view",
  serviceRequests: "transactions.view",
  transactions: "transactions.view",
  users: "users.view",
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
    items: [{ key: "transactions", label: "Transactions" }],
  },
  {
    label: "People",
    items: [{ key: "users", label: "Users" }],
  },
  {
    label: "System",
    items: [{ key: "auditLogs", label: "Audit log" }],
  },
];

export const PAGE_TITLES = {
  dashboard: "Today",
  kyc: "KYC review",
  withdrawals: "Withdrawals",
  serviceRequests: "Service requests",
  transactions: "Transactions",
  users: "Users",
  auditLogs: "Audit log",
  scannerLogs: "Scanner logs",
};

/* Screens that still live in the classic admin (/classic). */
export const CLASSIC_PAGES = [
  "Wallet view",
  "Company wallet",
  "Wallet adjustment",
  "Treasury operations",
  "Exchange rates",
  "Currency settings",
  "Referral rewards",
  "Roles & permissions",
  "System settings",
];

export const CLASSIC_URL = "/classic";

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
