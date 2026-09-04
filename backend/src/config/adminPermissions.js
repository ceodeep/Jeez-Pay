const ROLE_PERMISSIONS = {
  admin: ["*"],

  super_admin: ["*"],

  finance_admin: [
    "dashboard.view",
    "users.view",
    "wallets.view",
    "transactions.view",
    "wallets.adjust",
    "agents.view",
    "audit_logs.view",
    "settings.view",
    "currency_settings.view",
    "currency_settings.update",
    "crypto.withdrawals.view",
    "crypto.withdrawals.approve",
    "crypto.withdrawals.reject",
  ],

  kyc_officer: [
    "dashboard.view",
    "kyc.view",
    "kyc.approve",
    "kyc.reject",
    "audit_logs.view",
  ],

  support_agent: [
    "dashboard.view",
    "users.view",
    "wallets.view",
    "users.activate",
    "users.suspend",
    "transactions.view",
    "agents.view",
    "audit_logs.view",
  ],

  auditor: [
    "dashboard.view",
    "users.view",
    "wallets.view",
    "transactions.view",
    "agents.view",
    "kyc.view",
    "audit_logs.view",
    "settings.view",
    "currency_settings.view",
  ],

  user: [],
};

const ALL_PERMISSIONS = [
  "dashboard.view",
  "users.view",
  "users.activate",
  "users.suspend",
  "users.role.update",
  "wallets.view",
  "wallets.adjust",
  "transactions.view",
  "agents.view",
  "agents.manage",
  "kyc.view",
  "kyc.approve",
  "kyc.reject",
  "audit_logs.view",
  "settings.view",
  "settings.update",
  "currency_settings.view",
  "currency_settings.update",
  "crypto.withdrawals.view",
  "crypto.withdrawals.approve",
  "crypto.withdrawals.reject",
];

const MANAGEABLE_ROLES = [
  "user",
  "auditor",
  "support_agent",
  "kyc_officer",
  "finance_admin",
  "admin",
];

function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function hasPermission(role, permission) {
  const permissions = getPermissionsForRole(role);
  return permissions.includes("*") || permissions.includes(permission);
}

module.exports = {
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  MANAGEABLE_ROLES,
  getPermissionsForRole,
  hasPermission,
};
