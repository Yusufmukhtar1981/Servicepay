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

const hasOnlyBusinessPartnerPermissions = (permissions) =>
  Array.isArray(permissions) &&
  permissions.every((value) =>
    BUSINESS_PARTNER_PERMISSION_VALUES.includes(
      String(value || "").trim().toUpperCase()
    )
  );

module.exports = {
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
  BUSINESS_PARTNER_ACTION_PERMISSIONS,
  BUSINESS_PARTNER_PERMISSION_VALUES,
  normalizeBusinessPartnerPermissions,
  mergeBusinessPartnerViewPermissions,
  hasOnlyBusinessPartnerPermissions,
};