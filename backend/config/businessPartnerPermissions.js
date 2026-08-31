const BUSINESS_PARTNER_VIEW_PERMISSIONS = Object.freeze([
  "DASHBOARD",
  "OFFICERS",
  "CUSTOMERS",
  "APPLICATIONS",
  "REPAYMENTS",
  "REPORTS",
]);

const BUSINESS_PARTNER_ACTION_PERMISSIONS = Object.freeze([
  "OFFICER_MANAGEMENT",
  "SOLAR_ASSIGNMENT",
  "PHONE_ASSIGNMENT",
  "VERIFICATION_REVIEW",
]);

const BUSINESS_PARTNER_PERMISSION_VALUES = Object.freeze([
  ...BUSINESS_PARTNER_VIEW_PERMISSIONS,
  ...BUSINESS_PARTNER_ACTION_PERMISSIONS,
]);
const BUSINESS_PARTNER_PERMISSION_DOMAIN = "BUSINESS_PARTNER_DISTRIBUTOR";
const BUSINESS_PARTNER_PERMISSION_ALIASES = Object.freeze({
  DASHBOARD_VIEW: "DASHBOARD",
  OFFICERS_VIEW: "OFFICERS",
  CUSTOMERS_VIEW: "CUSTOMERS",
  APPLICATIONS_VIEW: "APPLICATIONS",
  REPAYMENTS_VIEW: "REPAYMENTS",
  REPORTS_VIEW: "REPORTS",
  OFFICERS_MANAGE: "OFFICER_MANAGEMENT",
  "business_partner.dashboard": "DASHBOARD",
  "business_partner.officers": "OFFICERS",
  "business_partner.customers": "CUSTOMERS",
  "business_partner.applications": "APPLICATIONS",
  "business_partner.repayments": "REPAYMENTS",
  "business_partner.reports": "REPORTS",
  "business_partner.officer_management": "OFFICER_MANAGEMENT",
  "solar.assignment": "SOLAR_ASSIGNMENT",
  "phone_financing.assignment": "PHONE_ASSIGNMENT",
});

const BUSINESS_PARTNER_SERVICES = Object.freeze(["SOLAR", "PHONE"]);

const BUSINESS_PARTNER_SERVICE_PERMISSIONS = Object.freeze({
  SOLAR: "SOLAR_ASSIGNMENT",
  PHONE: "PHONE_ASSIGNMENT",
});

const normalizeBusinessPartnerPermission = (permission) => {
  const raw = String(permission || "").trim();
  const upper = raw.toUpperCase();
  if (BUSINESS_PARTNER_PERMISSION_VALUES.includes(upper)) return upper;
  return BUSINESS_PARTNER_PERMISSION_ALIASES[raw] ||
    BUSINESS_PARTNER_PERMISSION_ALIASES[upper] ||
    null;
};

const normalizeBusinessPartnerPermissions = (permissions = []) => {
  if (!Array.isArray(permissions)) return [];
  return [
    ...new Set(
      permissions
        .map(normalizeBusinessPartnerPermission)
        .filter(Boolean)
    ),
  ];
};

const mergeBusinessPartnerViewPermissions = (permissions = []) => [
  ...new Set([
    ...BUSINESS_PARTNER_VIEW_PERMISSIONS,
    ...normalizeBusinessPartnerPermissions(permissions),
  ]),
];

const normalizeBusinessPartnerServices = (services = []) => {
  if (!Array.isArray(services)) return [];
  return [
    ...new Set(
      services
        .map((value) => String(value || "").trim().toUpperCase())
        .map((value) => (value === "PHONE_FINANCING" ? "PHONE" : value))
        .filter((value) => BUSINESS_PARTNER_SERVICES.includes(value))
    ),
  ].sort();
};

const hasOnlyBusinessPartnerPermissions = (permissions) =>
  Array.isArray(permissions) &&
  permissions.every((value) => normalizeBusinessPartnerPermission(value));

const hasOnlyBusinessPartnerServices = (services) =>
  Array.isArray(services) &&
  services.every((value) => {
    const normalized = String(value || "").trim().toUpperCase();
    return BUSINESS_PARTNER_SERVICES.includes(
      normalized === "PHONE_FINANCING" ? "PHONE" : normalized
    );
  });

const permissionsForBusinessPartnerServices = (
  services = [],
  permissions = []
) => {
  const normalizedServices = normalizeBusinessPartnerServices(services);
  const explicitPermissions = normalizeBusinessPartnerPermissions(
    permissions
  ).filter(
    (permission) =>
      permission !== "OFFICER_MANAGEMENT" &&
      !Object.values(BUSINESS_PARTNER_SERVICE_PERMISSIONS).includes(permission)
  );
  return [
    ...new Set([
      ...BUSINESS_PARTNER_VIEW_PERMISSIONS,
      ...explicitPermissions,
      ...(normalizedServices.length ? ["OFFICER_MANAGEMENT"] : []),
      ...normalizedServices.map(
        (service) => BUSINESS_PARTNER_SERVICE_PERMISSIONS[service]
      ),
    ]),
  ];
};

module.exports = {
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
  BUSINESS_PARTNER_ACTION_PERMISSIONS,
  BUSINESS_PARTNER_PERMISSION_VALUES,
  BUSINESS_PARTNER_PERMISSION_DOMAIN,
  BUSINESS_PARTNER_PERMISSION_ALIASES,
  BUSINESS_PARTNER_SERVICES,
  BUSINESS_PARTNER_SERVICE_PERMISSIONS,
  normalizeBusinessPartnerPermission,
  normalizeBusinessPartnerPermissions,
  mergeBusinessPartnerViewPermissions,
  normalizeBusinessPartnerServices,
  hasOnlyBusinessPartnerPermissions,
  hasOnlyBusinessPartnerServices,
  permissionsForBusinessPartnerServices,
};