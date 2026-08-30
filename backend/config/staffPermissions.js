const STAFF_PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: "dashboard.view",

  STAFF_CREATE: "staff.create",
  STAFF_VIEW: "staff.view",
  STAFF_UPDATE: "staff.update",
  STAFF_SUSPEND: "staff.suspend",

  ROLES_CREATE: "roles.create",
  ROLES_VIEW: "roles.view",
  ROLES_UPDATE: "roles.update",
  ROLES_DELETE: "roles.delete",
  ROLES_ASSIGN_PERMISSIONS: "roles.assign_permissions",

  USERS_VIEW: "users.view",
  USERS_UPDATE: "users.update",
  USERS_SUSPEND: "users.suspend",
  USERS_BLOCK: "users.block",
  CUSTOMER360_VIEW: "customer360.view",
  CUSTOMER360_FINANCIAL: "customer360.financial",
  CUSTOMER360_KYC: "customer360.kyc",
  CUSTOMER360_SECURITY: "customer360.security",

  BUSINESS_PARTNERS_VIEW: "business_partners.view",
  BUSINESS_PARTNERS_CREATE: "business_partners.create",
  BUSINESS_PARTNERS_UPDATE: "business_partners.update",
  BUSINESS_PARTNERS_STATUS: "business_partners.status",
  BUSINESS_PARTNERS_ASSIGN: "business_partners.assign",

  TRANSACTIONS_VIEW: "transactions.view",
  TRANSACTIONS_EXPORT: "transactions.export",
  TRANSACTIONS_REVERSE: "transactions.reverse",
  TRANSACTION_INTELLIGENCE_VIEW: "transaction_intelligence.view",
  TRANSACTION_INTELLIGENCE_REQUERY: "transaction_intelligence.requery",
  TRANSACTION_INTELLIGENCE_RECONCILE: "transaction_intelligence.reconcile",
  TRANSACTION_INTELLIGENCE_EXPORT: "transaction_intelligence.export",
  TRANSACTION_INTELLIGENCE_PROVIDER_HEALTH: "transaction_intelligence.provider_health",

  WALLETS_VIEW: "wallets.view",
  WALLETS_FUND: "wallets.fund",
  WALLETS_ADJUST: "wallets.adjust",
  WALLETS_FREEZE: "wallets.freeze",

  FINANCE_VIEW: "finance.view",
  FINANCE_RECONCILE: "finance.reconcile",
  FINANCE_EXPORT: "finance.export",
  FINANCE_APPROVE: "finance.approve",

  DELIVERY_VIEW: "delivery.view",
  DELIVERY_ASSIGN: "delivery.assign",
  DELIVERY_UPDATE: "delivery.update",
  DELIVERY_CANCEL: "delivery.cancel",

  SUPPORT_VIEW: "support.view",
  SUPPORT_CREATE: "support.create",
  SUPPORT_ASSIGN: "support.assign",
  SUPPORT_RESOLVE: "support.resolve",

  KYC_VIEW: "kyc.view",
  KYC_APPROVE: "kyc.approve",
  KYC_REJECT: "kyc.reject",

  TRUST_VIEW: "trust.view",
  TRUST_RESOLVE: "trust.resolve",
  TRUST_RESTRICT: "trust.restrict",

  AUDIT_VIEW: "audit.view",
  AUDIT_EXPORT: "audit.export",

  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",

  SETTINGS_VIEW: "settings.view",
  SETTINGS_UPDATE: "settings.update",

  NOTIFICATIONS_CREATE: "notifications.create",
  NOTIFICATIONS_SEND: "notifications.send",
});

const STAFF_PERMISSION_VALUES = Object.freeze(
  Object.values(STAFF_PERMISSIONS)
);

module.exports = {
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_VALUES,
};
