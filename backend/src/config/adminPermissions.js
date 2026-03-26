const ROLE_PERMISSIONS = {
  admin: ["*"],

  super_admin: ["*"],

  finance_admin: [
  "dashboard.view",
  "users.view",
  "wallets.view",
  "transactions.view",
  "wallets.adjust",
  "audit_logs.view",
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
  "audit_logs.view",
],

  auditor: [
  "dashboard.view",
  "users.view",
  "wallets.view",
  "transactions.view",
  "kyc.view",
  "audit_logs.view",
],
};

function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function hasPermission(role, permission) {
  const permissions = getPermissionsForRole(role);
  return permissions.includes("*") || permissions.includes(permission);
}

module.exports = {
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  hasPermission,
};