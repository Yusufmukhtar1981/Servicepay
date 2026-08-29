const BUSINESS_PARTNER_VIEW_PERMISSIONS = Object.freeze([
  "DASHBOARD",
  "OFFICERS",
  "CUSTOMERS",
  "APPLICATIONS",
  "REPAYMENTS",
  "REPORTS",
]);

const BUSINESS_PARTNER_ACTION_PERMISSIONS = Object.freeze([
  "SOLAR_ASSIGNMENT",
  "PHONE_ASSIGNMENT",
  "VERIFICATION_REVIEW",
]);

const BUSINESS_PARTNER_PERMISSION_VALUES = Object.freeze([
  ...BUSINESS_PARTNER_VIEW_PERMISSIONS,
  ...BUSINESS_PARTNER_ACTION_PERMISSIONS,
]);

const BUSINESS_PARTNER_SERVICES = Object.freeze(["SOLAR", "PHONE"]);

const BUSINESS_PARTNER_SERVICE_PERMISSIONS = Object.freeze({
  SOLAR: "SOLAR_ASSIGNMENT",
  PHONE: "PHONE_ASSIGNMENT",
});

const normalizeBusinessPartnerPermissions = (permissions = []) => {
  if (!Array.isArray(permissions)) return [];
  return [
    ...new Set(
      permissions
        .map((value) => String(value || "").trim().toUpperCase())
        .filter((value) => BUSINESS_PARTNER_PERMISSION_VALUES.includes(value))
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
  permissions.every((value) =>
    BUSINESS_PARTNER_PERMISSION_VALUES.includes(
      String(value || "").trim().toUpperCase()
    )
  );

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
) => [
  ...new Set([
    ...BUSINESS_PARTNER_VIEW_PERMISSIONS,
    ...normalizeBusinessPartnerPermissions(permissions),
    ...normalizeBusinessPartnerServices(services).map(
      (service) => BUSINESS_PARTNER_SERVICE_PERMISSIONS[service]
    ),
  ]),
];

module.exports = {
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
  BUSINESS_PARTNER_ACTION_PERMISSIONS,
  BUSINESS_PARTNER_PERMISSION_VALUES,
  BUSINESS_PARTNER_SERVICES,
  BUSINESS_PARTNER_SERVICE_PERMISSIONS,
  normalizeBusinessPartnerPermissions,
  mergeBusinessPartnerViewPermissions,
  normalizeBusinessPartnerServices,
  hasOnlyBusinessPartnerPermissions,
  hasOnlyBusinessPartnerServices,
  permissionsForBusinessPartnerServices,
};