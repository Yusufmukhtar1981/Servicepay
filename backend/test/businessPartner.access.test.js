const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
  BUSINESS_PARTNER_ACTION_PERMISSIONS,
  mergeBusinessPartnerViewPermissions,
  hasOnlyBusinessPartnerPermissions,
} = require("../config/businessPartnerPermissions");

test("view access covers every Business Partner dashboard module", () => {
  assert.deepEqual(BUSINESS_PARTNER_VIEW_PERMISSIONS, [
    "DASHBOARD",
    "OFFICERS",
    "CUSTOMERS",
    "APPLICATIONS",
    "REPAYMENTS",
    "REPORTS",
  ]);
});

test("view repair normalizes legacy keys without granting sensitive actions", () => {
  const repaired = mergeBusinessPartnerViewPermissions([
    "customers",
    "phone_assignment",
    "unknown_permission",
  ]);

  for (const permission of BUSINESS_PARTNER_VIEW_PERMISSIONS) {
    assert.equal(repaired.includes(permission), true);
  }
  assert.equal(repaired.includes("PHONE_ASSIGNMENT"), true);
  assert.equal(repaired.includes("UNKNOWN_PERMISSION"), false);
  assert.equal(repaired.includes("SOLAR_ASSIGNMENT"), false);
  assert.equal(repaired.includes("OFFICER_MANAGEMENT"), false);
  assert.equal(repaired.includes("VERIFICATION_REVIEW"), false);
  assert.deepEqual(BUSINESS_PARTNER_ACTION_PERMISSIONS, [
    "OFFICER_MANAGEMENT",
    "SOLAR_ASSIGNMENT",
    "PHONE_ASSIGNMENT",
    "VERIFICATION_REVIEW",
  ]);
});

test("admin permission validation rejects unrelated permission keys", () => {
  assert.equal(
    hasOnlyBusinessPartnerPermissions(["DASHBOARD", "REPORTS"]),
    true
  );
  assert.equal(
    hasOnlyBusinessPartnerPermissions(["DASHBOARD", "finance.approve"]),
    false
  );
  assert.equal(hasOnlyBusinessPartnerPermissions("DASHBOARD"), false);
});