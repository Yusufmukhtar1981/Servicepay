const permission = (key, value, module, label, description, risk = "STANDARD") =>
  Object.freeze({ key, value, module, label, description, risk });

const STAFF_PERMISSION_CATALOG = Object.freeze([
  permission("DASHBOARD_VIEW", "dashboard.view", "DASHBOARD", "View dashboard", "View Admin dashboard summaries."),
  permission("STAFF_CREATE", "staff.create", "STAFF", "Create staff", "Create internal staff accounts.", "PRIVILEGED"),
  permission("STAFF_VIEW", "staff.view", "STAFF", "View staff", "View internal staff accounts."),
  permission("STAFF_UPDATE", "staff.update", "STAFF", "Update staff", "Update internal staff details.", "PRIVILEGED"),
  permission("STAFF_SUSPEND", "staff.suspend", "STAFF", "Suspend staff", "Suspend or reactivate staff accounts.", "PRIVILEGED"),
  permission("STAFF_ASSIGN_ROLE", "staff.assign_role", "STAFF", "Assign staff roles", "Assign an active role to internal staff.", "PRIVILEGED"),
  permission("ROLES_CREATE", "roles.create", "ROLES", "Create roles", "Create non-system staff roles.", "PRIVILEGED"),
  permission("ROLES_VIEW", "roles.view", "ROLES", "View roles", "View roles and the permission catalog."),
  permission("ROLES_UPDATE", "roles.update", "ROLES", "Update roles", "Edit role details.", "PRIVILEGED"),
  permission("ROLES_DELETE", "roles.delete", "ROLES", "Delete roles", "Delete unused non-system roles.", "CRITICAL"),
  permission("ROLES_ASSIGN_PERMISSIONS", "roles.assign_permissions", "ROLES", "Assign permissions", "Change permissions granted by a role.", "CRITICAL"),
  permission("ROLES_ENABLE", "roles.enable", "ROLES", "Enable or disable roles", "Change whether a role can be assigned.", "PRIVILEGED"),
  permission("USERS_CREATE", "users.create", "USERS", "Create managed users", "Create users allowed by the actor hierarchy.", "PRIVILEGED"),
  permission("USERS_VIEW", "users.view", "USERS", "View users", "View users within the actor data scope."),
  permission("USERS_UPDATE", "users.update", "USERS", "Update users", "Update users within the actor data scope.", "PRIVILEGED"),
  permission("USERS_SUSPEND", "users.suspend", "USERS", "Suspend users", "Suspend or reactivate users within scope.", "PRIVILEGED"),
  permission("USERS_BLOCK", "users.block", "USERS", "Block users", "Block users within scope.", "CRITICAL"),
  permission("USERS_DELETE", "users.delete", "USERS", "Safely delete users", "Disable an account while preserving financial records.", "CRITICAL"),
  permission("CUSTOMER360_VIEW", "customer360.view", "CUSTOMER_360", "View Customer 360", "Search customers and view the safe Customer 360 profile."),
  permission("CUSTOMER360_FINANCIAL", "customer360.financial", "CUSTOMER_360", "View Customer 360 finances", "View read-only customer wallet and transaction summaries.", "PRIVILEGED"),
  permission("CUSTOMER360_KYC", "customer360.kyc", "CUSTOMER_360", "View Customer 360 identity", "View masked customer KYC and identity-verification details.", "PRIVILEGED"),
  permission("CUSTOMER360_SECURITY", "customer360.security", "CUSTOMER_360", "View Customer 360 security", "View defensible customer security and risk signals.", "PRIVILEGED"),
  permission("TRANSACTIONS_VIEW", "transactions.view", "TRANSACTIONS", "View transactions", "View transactions within the actor data scope."),
  permission("TRANSACTIONS_EXPORT", "transactions.export", "TRANSACTIONS", "Export transactions", "Export permitted transaction records.", "PRIVILEGED"),
  permission("TRANSACTIONS_REVERSE", "transactions.reverse", "TRANSACTIONS", "Reverse transactions", "Perform supported transaction reversals.", "CRITICAL"),
  permission("TRANSACTIONS_REQUERY", "transactions.requery", "TRANSACTIONS", "Requery transactions", "Requery ambiguous provider transactions.", "CRITICAL"),
  permission("TRANSACTION_INTELLIGENCE_VIEW", "transaction_intelligence.view", "TRANSACTION_INTELLIGENCE", "View Transaction Intelligence", "Search and investigate permitted transaction records."),
  permission("TRANSACTION_INTELLIGENCE_REQUERY", "transaction_intelligence.requery", "TRANSACTION_INTELLIGENCE", "Requery in Transaction Intelligence", "Query an existing provider transaction status without creating a new purchase.", "CRITICAL"),
  permission("TRANSACTION_INTELLIGENCE_RECONCILE", "transaction_intelligence.reconcile", "TRANSACTION_INTELLIGENCE", "Reconcile transactions", "Apply only supported ledger-safe reconciliation decisions.", "CRITICAL"),
  permission("TRANSACTION_INTELLIGENCE_EXPORT", "transaction_intelligence.export", "TRANSACTION_INTELLIGENCE", "Export reconciliation results", "Export masked permitted reconciliation records.", "PRIVILEGED"),
  permission("TRANSACTION_INTELLIGENCE_PROVIDER_HEALTH", "transaction_intelligence.provider_health", "TRANSACTION_INTELLIGENCE", "View provider health", "View provider health calculated from observed transaction outcomes.", "PRIVILEGED"),
  permission("FRAUD_RISK_VIEW", "fraud_risk.view", "FRAUD_RISK", "View Fraud & Risk", "View durable fraud-risk alerts and observed risk metrics.", "PRIVILEGED"),
  permission("FRAUD_RISK_INVESTIGATE", "fraud_risk.investigate", "FRAUD_RISK", "Investigate fraud risk", "Evaluate evidence and add investigation notes.", "PRIVILEGED"),
  permission("FRAUD_RISK_ASSIGN", "fraud_risk.assign", "FRAUD_RISK", "Assign fraud risk cases", "Assign fraud-risk alerts within the authorized scope.", "PRIVILEGED"),
  permission("FRAUD_RISK_RESOLVE", "fraud_risk.resolve", "FRAUD_RISK", "Resolve fraud risk cases", "Change fraud-risk case status with an audit reason.", "CRITICAL"),
  permission("FRAUD_RISK_RULES_MANAGE", "fraud_risk.rules.manage", "FRAUD_RISK", "Manage fraud-risk rules", "Version and enable conservative fraud-risk monitoring rules.", "CRITICAL"),
  permission("FRAUD_RISK_EXPORT", "fraud_risk.export", "FRAUD_RISK", "Export fraud-risk alerts", "Export masked fraud-risk records.", "PRIVILEGED"),
  permission("FRAUD_RISK_RESTRICT", "fraud_risk.restrict", "FRAUD_RISK", "Restrict fraud risk", "Reserved for a future supported restriction workflow.", "CRITICAL"),
  permission("WALLETS_VIEW", "wallets.view", "WALLETS", "View wallets", "View permitted wallet records."),
  permission("WALLETS_FUND", "wallets.fund", "WALLETS", "Fund wallets", "Approve supported wallet funding.", "CRITICAL"),
  permission("WALLETS_ADJUST", "wallets.adjust", "WALLETS", "Adjust wallets", "Post audited wallet adjustments.", "CRITICAL"),
  permission("WALLETS_FREEZE", "wallets.freeze", "WALLETS", "Freeze wallets", "Apply supported wallet restrictions.", "CRITICAL"),
  permission("FUNDING_VIEW", "funding.view", "FUNDING", "View funding", "View manual funding requests."),
  permission("FUNDING_APPROVE", "funding.approve", "FUNDING", "Approve funding", "Approve or reject manual funding requests.", "CRITICAL"),
  permission("WITHDRAWALS_VIEW", "withdrawals.view", "WITHDRAWALS", "View withdrawals", "View customer and operational withdrawal requests."),
  permission("WITHDRAWALS_APPROVE", "withdrawals.approve", "WITHDRAWALS", "Approve withdrawals", "Approve, reject, or mark withdrawals paid.", "CRITICAL"),
  permission("FINANCE_VIEW", "finance.view", "FINANCE", "View finance controls", "View financial operations and controls."),
  permission("FINANCE_RECONCILE", "finance.reconcile", "FINANCE", "Reconcile finance", "Perform supported reconciliation actions.", "CRITICAL"),
  permission("FINANCE_EXPORT", "finance.export", "FINANCE", "Export finance data", "Export permitted financial reports.", "PRIVILEGED"),
  permission("FINANCE_APPROVE", "finance.approve", "FINANCE", "Approve financial actions", "Approve high-risk financial operations.", "CRITICAL"),
  permission("DELIVERY_VIEW", "delivery.view", "DELIVERY", "View deliveries", "View deliveries and available riders."),
  permission("DELIVERY_ASSIGN", "delivery.assign", "DELIVERY", "Assign riders", "Assign and unassign riders.", "PRIVILEGED"),
  permission("DELIVERY_UPDATE", "delivery.update", "DELIVERY", "Update deliveries", "Update delivery status and price.", "PRIVILEGED"),
  permission("DELIVERY_CANCEL", "delivery.cancel", "DELIVERY", "Cancel deliveries", "Cancel supported delivery requests.", "PRIVILEGED"),
  permission("RIDERS_VIEW", "riders.view", "DELIVERY", "View riders", "View delivery-rider accounts."),
  permission("RIDERS_MANAGE", "riders.manage", "DELIVERY", "Manage riders", "Create and update rider accounts.", "PRIVILEGED"),
  permission("MARKETPLACE_VIEW", "marketplace.view", "MARKETPLACE", "View marketplace", "View marketplace moderation queues."),
  permission("MARKETPLACE_MODERATE", "marketplace.moderate", "MARKETPLACE", "Moderate marketplace", "Approve, reject, or suspend marketplace products.", "PRIVILEGED"),
  permission("SOLAR_VIEW", "solar.view", "SOLAR", "View Solar", "View Solar packages, applications, finance, and reports."),
  permission("SOLAR_MANAGE", "solar.manage", "SOLAR", "Manage Solar", "Manage Solar packages, applications, assignments, and recovery.", "PRIVILEGED"),
  permission("PHONE_FINANCING_VIEW", "phone_financing.view", "PHONE_FINANCING", "View phone financing", "View phone products, applications, devices, and finance."),
  permission("PHONE_FINANCING_MANAGE", "phone_financing.manage", "PHONE_FINANCING", "Manage phone financing", "Manage products, applications, officers, inventory, and handover.", "PRIVILEGED"),
  permission("EMPOWERMENT_VIEW", "empowerment.view", "EMPOWERMENT", "View empowerment", "View programs, beneficiaries, and reports."),
  permission("EMPOWERMENT_MANAGE", "empowerment.manage", "EMPOWERMENT", "Manage empowerment", "Manage organizations, funding, and disbursements.", "CRITICAL"),
  permission("AMANA_VIEW", "amana.view", "AMANA", "View Amana", "View Amana orders and fulfilment evidence."),
  permission("AMANA_MANAGE", "amana.manage", "AMANA", "Manage Amana", "Review, fund, and complete Amana orders.", "CRITICAL"),
  permission("AIRTIME_TO_CASH_VIEW", "airtime_to_cash.view", "AIRTIME_TO_CASH", "View airtime-to-cash", "View airtime-to-cash requests."),
  permission("AIRTIME_TO_CASH_MANAGE", "airtime_to_cash.manage", "AIRTIME_TO_CASH", "Manage airtime-to-cash", "Approve or reject airtime-to-cash requests.", "CRITICAL"),
  permission("SUPPORT_VIEW", "support.view", "SUPPORT", "View support", "View customer support tickets."),
  permission("SUPPORT_CREATE", "support.create", "SUPPORT", "Create support cases", "Create supported internal support cases."),
  permission("SUPPORT_ASSIGN", "support.assign", "SUPPORT", "Assign support", "Assign tickets to permitted staff.", "PRIVILEGED"),
  permission("SUPPORT_RESOLVE", "support.resolve", "SUPPORT", "Resolve support", "Reply, add notes, and update ticket status.", "PRIVILEGED"),
  permission("KYC_VIEW", "kyc.view", "KYC", "View KYC", "View identity-verification submissions."),
  permission("KYC_APPROVE", "kyc.approve", "KYC", "Approve KYC", "Approve identity-verification submissions.", "CRITICAL"),
  permission("KYC_REJECT", "kyc.reject", "KYC", "Reject KYC", "Reject identity-verification submissions.", "PRIVILEGED"),
  permission("TRUST_VIEW", "trust.view", "TRUST", "View trust controls", "View trust profiles, deals, and disputes."),
  permission("TRUST_RESOLVE", "trust.resolve", "TRUST", "Resolve trust disputes", "Resolve protected-deal disputes.", "CRITICAL"),
  permission("TRUST_RESTRICT", "trust.restrict", "TRUST", "Restrict trust profiles", "Apply trust-profile restrictions.", "CRITICAL"),
  permission("BUSINESS_PARTNERS_VIEW", "business_partners.view", "BUSINESS_PARTNERS", "View Business Partners", "View distributor Business Partner records."),
  permission("BUSINESS_PARTNERS_CREATE", "business_partners.create", "BUSINESS_PARTNERS", "Create Business Partners", "Create distributor Business Partner accounts.", "PRIVILEGED"),
  permission("BUSINESS_PARTNERS_UPDATE", "business_partners.update", "BUSINESS_PARTNERS", "Update Business Partners", "Update distributor Business Partner accounts.", "PRIVILEGED"),
  permission("BUSINESS_PARTNERS_STATUS", "business_partners.status", "BUSINESS_PARTNERS", "Change partner status", "Enable or disable distributor Business Partners.", "PRIVILEGED"),
  permission("BUSINESS_PARTNERS_ASSIGN", "business_partners.assign", "BUSINESS_PARTNERS", "Assign partner work", "Assign officers and applications to distributor Business Partners.", "PRIVILEGED"),
  permission("PARTNER_API_VIEW", "partner_api.view", "PARTNER_API", "View API partners", "View API-client Partners and usage."),
  permission("PARTNER_API_MANAGE", "partner_api.manage", "PARTNER_API", "Manage API partners", "Manage API-client Partner status, limits, and credentials.", "CRITICAL"),
  permission("PARTNER_API_RECONCILE", "partner_api.reconcile", "PARTNER_API", "Reconcile API purchases", "Requery and resolve eligible API Partner purchases.", "CRITICAL"),
  permission("COMMISSIONS_VIEW", "commissions.view", "COMMISSIONS", "View commissions", "View product and partner commission settings."),
  permission("COMMISSIONS_MANAGE", "commissions.manage", "COMMISSIONS", "Manage commissions", "Change product commission settings.", "CRITICAL"),
  permission("NOTIFICATIONS_VIEW", "notifications.view", "COMMUNICATIONS", "View communication history", "View notification and email delivery history."),
  permission("NOTIFICATIONS_CREATE", "notifications.create", "COMMUNICATIONS", "Create notifications", "Create targeted customer notifications.", "PRIVILEGED"),
  permission("NOTIFICATIONS_SEND", "notifications.send", "COMMUNICATIONS", "Send broadcasts", "Send notification or email broadcasts.", "CRITICAL"),
  permission("COMMUNICATIONS_VIEW", "communications.view", "COMMUNICATIONS", "View communications", "Open the Admin communications workspace."),
  permission("EMAIL_CAMPAIGN_CREATE", "email_campaign.create", "COMMUNICATIONS", "Create email campaigns", "Create and edit customer email drafts.", "PRIVILEGED"),
  permission("EMAIL_CAMPAIGN_SEND", "email_campaign.send", "COMMUNICATIONS", "Send email campaigns", "Send test email and confirmed customer email campaigns.", "CRITICAL"),
  permission("EMAIL_CAMPAIGN_HISTORY_VIEW", "email_campaign.history_view", "COMMUNICATIONS", "View email campaign history", "View customer email campaign status and safe delivery results."),
  permission("EMAIL_CAMPAIGN_MANAGE", "email_campaign.manage", "COMMUNICATIONS", "Manage email campaigns", "Delete drafts and cancel eligible campaigns.", "CRITICAL"),
  permission("AUDIT_VIEW", "audit.view", "AUDIT", "View audit logs", "View immutable Admin audit logs.", "PRIVILEGED"),
  permission("AUDIT_EXPORT", "audit.export", "AUDIT", "Export audit logs", "Export permitted audit records.", "PRIVILEGED"),
  permission("REPORTS_VIEW", "reports.view", "REPORTS", "View reports", "View permitted operational reports."),
  permission("REPORTS_EXPORT", "reports.export", "REPORTS", "Export reports", "Export permitted operational reports.", "PRIVILEGED"),
  permission("SETTINGS_VIEW", "settings.view", "SETTINGS", "View settings", "View platform configuration."),
  permission("SETTINGS_UPDATE", "settings.update", "SETTINGS", "Update settings", "Update supported platform configuration.", "CRITICAL"),
]);

const STAFF_PERMISSIONS = Object.freeze(Object.fromEntries(
  STAFF_PERMISSION_CATALOG.map((item) => [item.key, item.value])
));
const STAFF_PERMISSION_VALUES = Object.freeze(
  STAFF_PERMISSION_CATALOG.map((item) => item.value)
);
const permissionByKey = new Map(
  STAFF_PERMISSION_CATALOG.map((item) => [item.key, item.value])
);
const permissionByValue = new Set(STAFF_PERMISSION_VALUES);

const STAFF_PERMISSION_ALIASES = Object.freeze({
  "role.view": STAFF_PERMISSIONS.ROLES_VIEW,
  "role.create": STAFF_PERMISSIONS.ROLES_CREATE,
  "role.update": STAFF_PERMISSIONS.ROLES_UPDATE,
  "roles.assign": STAFF_PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
  "wallet.view": STAFF_PERMISSIONS.WALLETS_VIEW,
  "wallet.fund": STAFF_PERMISSIONS.WALLETS_FUND,
  "wallet.adjust": STAFF_PERMISSIONS.WALLETS_ADJUST,
  "business_partner.view": STAFF_PERMISSIONS.BUSINESS_PARTNERS_VIEW,
  "business_partner.manage": STAFF_PERMISSIONS.BUSINESS_PARTNERS_UPDATE,
  "phone-financing.view": STAFF_PERMISSIONS.PHONE_FINANCING_VIEW,
  "phone-financing.manage": STAFF_PERMISSIONS.PHONE_FINANCING_MANAGE,
  "settings.edit": STAFF_PERMISSIONS.SETTINGS_UPDATE,
  "communications.email.create": STAFF_PERMISSIONS.EMAIL_CAMPAIGN_CREATE,
  "communications.email.send": STAFF_PERMISSIONS.EMAIL_CAMPAIGN_SEND,
  "communications.email.history": STAFF_PERMISSIONS.EMAIL_CAMPAIGN_HISTORY_VIEW,
  "communications.email.manage": STAFF_PERMISSIONS.EMAIL_CAMPAIGN_MANAGE,
});

const normalizeStaffPermission = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (permissionByValue.has(raw)) return raw;
  const lower = raw.toLowerCase();
  if (permissionByValue.has(lower)) return lower;
  if (STAFF_PERMISSION_ALIASES[lower]) return STAFF_PERMISSION_ALIASES[lower];
  const key = raw.toUpperCase().replace(/[\s.-]+/g, "_");
  return permissionByKey.get(key) || null;
};

const validateStaffPermissions = (
  permissions,
  { allowWildcard = false, allowEmpty = true } = {}
) => {
  if (!Array.isArray(permissions)) {
    return { valid: false, permissions: [], invalidPermissions: [], message: "Permissions must be provided as a list." };
  }
  const normalized = [];
  const invalidPermissions = [];
  for (const item of permissions) {
    const raw = String(item || "").trim();
    if (allowWildcard && raw === "*") {
      normalized.push("*");
      continue;
    }
    const value = normalizeStaffPermission(raw);
    if (!value) invalidPermissions.push(raw);
    else normalized.push(value);
  }
  const invalid = [...new Set(invalidPermissions)];
  const valid = [...new Set(normalized)];
  if (invalid.length) {
    return { valid: false, permissions: valid, invalidPermissions: invalid, message: `Unknown permissions: ${invalid.join(", ")}.` };
  }
  if (!allowEmpty && valid.length === 0) {
    return { valid: false, permissions: [], invalidPermissions: [], message: "At least one permission is required." };
  }
  return { valid: true, permissions: valid, invalidPermissions: [], message: "" };
};

const ROLE_ALIASES = Object.freeze({
  ADMIN: "HEAD_OFFICE",
  SUPER_ADMIN: "HEAD_OFFICE",
  HEAD_OFFICE_ADMIN: "HEAD_OFFICE",
  SUPPORT_AGENT: "SUPPORT_STAFF",
  CUSTOMER_SUPPORT: "SUPPORT_STAFF",
  RIDER: "DELIVERY_RIDER",
  PHONE_OFFICER: "PHONE_FINANCING_OFFICER",
});
const normalizeRoleName = (value) => String(value || "")
  .trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const canonicalRoleName = (value) => {
  const normalized = normalizeRoleName(value);
  return ROLE_ALIASES[normalized] || normalized;
};
const FULL_ACCESS_ROLE_NAMES = Object.freeze([
  "HEAD_OFFICE", "ADMIN", "SUPER_ADMIN", "HEAD_OFFICE_ADMIN",
]);
const ROLE_HIERARCHY = Object.freeze({
  HEAD_OFFICE: 100,
  SUB_ADMIN: 80,
  INTERNAL_AUDITOR: 70,
  FINANCE_MANAGER: 65,
  OPERATIONS_MANAGER: 60,
  COMPLIANCE_MANAGER: 60,
  DELIVERY_MANAGER: 60,
  SUPPORT_MANAGER: 55,
  ZONAL_MANAGER: 50,
  STATE_MANAGER: 40,
  ACCOUNTANT: 35,
  KYC_OFFICER: 30,
  SUPPORT_STAFF: 25,
  SOLAR_OFFICER: 20,
  PHONE_FINANCING_OFFICER: 20,
  DELIVERY_RIDER: 10,
  AGENT: 10,
  BUSINESS_PARTNER: 10,
  CUSTOMER: 0,
});
const scopeForRole = (role, user = {}) => {
  const canonical = canonicalRoleName(role);
  if (canonical === "HEAD_OFFICE") return Object.freeze({ type: "GLOBAL" });
  if (canonical === "ZONAL_MANAGER") return Object.freeze({ type: "ZONE", zone: user.zone || null });
  if (canonical === "STATE_MANAGER") {
    return Object.freeze({ type: "STATE", zone: user.zone || null, state: user.state || null });
  }
  if (canonical === "BUSINESS_PARTNER") {
    return Object.freeze({
      type: "BUSINESS_PARTNER",
      businessPartnerId: user.businessPartnerProfile || user.businessPartnerId || null,
    });
  }
  return Object.freeze({ type: "SELF", userId: user._id || user.id || null });
};
const directRolePermissions = Object.freeze({
  ZONAL_MANAGER: Object.freeze([
    STAFF_PERMISSIONS.DASHBOARD_VIEW, STAFF_PERMISSIONS.USERS_CREATE,
    STAFF_PERMISSIONS.USERS_VIEW, STAFF_PERMISSIONS.USERS_UPDATE,
    STAFF_PERMISSIONS.USERS_SUSPEND, STAFF_PERMISSIONS.TRANSACTIONS_VIEW,
    STAFF_PERMISSIONS.REPORTS_VIEW,
  ]),
  STATE_MANAGER: Object.freeze([
    STAFF_PERMISSIONS.DASHBOARD_VIEW, STAFF_PERMISSIONS.USERS_CREATE,
    STAFF_PERMISSIONS.USERS_VIEW, STAFF_PERMISSIONS.USERS_UPDATE,
    STAFF_PERMISSIONS.USERS_SUSPEND, STAFF_PERMISSIONS.TRANSACTIONS_VIEW,
    STAFF_PERMISSIONS.REPORTS_VIEW,
  ]),
});

const effectivePermissionsForUser = (user = {}) => {
  const rawRole = normalizeRoleName(user.role);
  if (FULL_ACCESS_ROLE_NAMES.includes(rawRole)) return ["*"];
  const canonical = canonicalRoleName(rawRole);
  if (canonical === "STAFF" && user.isStaff === true) {
    const role = user.staffRoleId;
    if (!role || typeof role !== "object" || role.status !== "ACTIVE") return [];
    return validateStaffPermissions(role.permissions || []).permissions;
  }
  return [...(directRolePermissions[canonical] || [])];
};

module.exports = {
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_VALUES,
  STAFF_PERMISSION_CATALOG,
  STAFF_PERMISSION_ALIASES,
  ROLE_ALIASES,
  ROLE_HIERARCHY,
  FULL_ACCESS_ROLE_NAMES,
  directRolePermissions,
  normalizeRoleName,
  canonicalRoleName,
  canonicalPermission: normalizeStaffPermission,
  normalizeStaffPermission,
  validateStaffPermissions,
  scopeForRole,
  effectivePermissionsForUser,
};