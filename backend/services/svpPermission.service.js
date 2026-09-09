const { validateStaffPermissions } = require("../config/permissionRegistry");

// SVPs are read-only executives.  This is intentionally not a subset chosen
// by callers: critical permissions can never be persisted on an SVP account.
const SVP_PERMISSION_ALLOWLIST = Object.freeze([
  "dashboard.view", "reports.view", "reports.export", "audit.view",
  "transactions.view", "transaction_intelligence.view",
  "users.view", "branches.view", "delivery.view", "riders.view",
  "finance.view", "withdrawals.view", "kyc.view",
]);

const validateSVPPermissions = (permissions) => {
  const parsed = validateStaffPermissions(permissions || [], { allowEmpty: true });
  if (!parsed.valid) return parsed;
  const forbidden = parsed.permissions.filter((permission) => !SVP_PERMISSION_ALLOWLIST.includes(permission));
  return forbidden.length
    ? { valid: false, permissions: [], message: `SVP permissions are read-only and cannot include: ${forbidden.join(", ")}.` }
    : { valid: true, permissions: parsed.permissions, message: "" };
};
module.exports = { SVP_PERMISSION_ALLOWLIST, validateSVPPermissions };