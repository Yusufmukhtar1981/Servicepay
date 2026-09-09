const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STAFF_PERMISSIONS: P,
  canonicalPermission,
  validateStaffPermissions,
  effectivePermissionsForUser,
  scopeForRole,
} = require("../config/staffPermissions");
const {
  BUSINESS_PARTNER_PERMISSION_DOMAIN,
  normalizeBusinessPartnerPermissions,
} = require("../config/businessPartnerPermissions");
const {
  scopeFilterFor,
  isUserWithinScope,
  requirePermission,
} = require("../middleware/staffPermission.middleware");
const { protect } = require("../middleware/auth.middleware");

const responseRecorder = () => {
  const result = { statusCode: null, body: null };
  return {
    result,
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
};

test("staff permissions normalize legacy aliases and reject unknown values", () => {
  assert.equal(canonicalPermission("role.view"), P.ROLES_VIEW);
  assert.equal(canonicalPermission("role.update"), P.ROLES_UPDATE);

  const result = validateStaffPermissions([
    "role.view",
    P.USERS_VIEW,
    "NOT_A_REAL_PERMISSION",
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.permissions, [P.ROLES_VIEW, P.USERS_VIEW]);
  assert.deepEqual(result.invalidPermissions, ["NOT_A_REAL_PERMISSION"]);
});

test("permission domains stay separate while legacy Business Partner aliases work", () => {
  assert.equal(BUSINESS_PARTNER_PERMISSION_DOMAIN, "BUSINESS_PARTNER_DISTRIBUTOR");
  assert.deepEqual(
    normalizeBusinessPartnerPermissions([
      "business_partner.dashboard",
      "solar.assignment",
    ]),
    ["DASHBOARD", "SOLAR_ASSIGNMENT"]
  );
  assert.equal(canonicalPermission("SOLAR_ASSIGNMENT"), null);
});

test("HEAD_OFFICE keeps wildcard access and staff receives only active role permissions", () => {
  assert.deepEqual(effectivePermissionsForUser({ role: "HEAD_OFFICE" }), ["*"]);
  assert.deepEqual(
    effectivePermissionsForUser({
      role: "STAFF",
      isStaff: true,
      staffRoleId: {
        status: "ACTIVE",
        permissions: [P.USERS_VIEW],
      },
    }),
    [P.USERS_VIEW]
  );
  assert.deepEqual(
    effectivePermissionsForUser({
      role: "STAFF",
      isStaff: true,
      staffRoleId: {
        status: "INACTIVE",
        permissions: [P.USERS_VIEW],
      },
    }),
    []
  );
});

test("manager scope helpers constrain query and record access", () => {
  const actorId = "64f000000000000000000001";
  const zonalScope = scopeForRole("ZONAL_MANAGER", {
    _id: actorId,
    zone: "North West",
  });
  const staffAccess = { scope: zonalScope };
  assert.deepEqual(scopeFilterFor(staffAccess), { zone: "North West" });
  assert.equal(
    isUserWithinScope(
      staffAccess,
      { zonalManagerId: actorId, zone: "North West" },
    ),
    true
  );
  assert.equal(
    isUserWithinScope(
      staffAccess,
      {
        zonalManagerId: "64f000000000000000000002",
        zone: "South West",
      },
    ),
    false
  );
});

test("staff permission middleware rejects missing authentication and unauthorized modules", async () => {
  const unauthenticated = responseRecorder();
  await protect({ headers: {} }, unauthenticated, () => {
    throw new Error("next must not be called");
  });
  assert.equal(unauthenticated.result.statusCode, 401);

  const kycOnly = responseRecorder();
  let nextCalled = false;
  requirePermission(P.SUPPORT_VIEW)(
    { staffAccess: { isHeadOffice: false, permissions: [P.KYC_VIEW] } },
    kycOnly,
    () => { nextCalled = true; },
  );
  assert.equal(kycOnly.result.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("Support, KYC, Finance, and Operations permissions remain isolated", () => {
  const scenarios = [
    { name: "Support", permissions: [P.SUPPORT_VIEW, P.SUPPORT_RESOLVE], allowed: P.SUPPORT_RESOLVE, denied: P.KYC_APPROVE },
    { name: "KYC", permissions: [P.KYC_VIEW, P.KYC_APPROVE], allowed: P.KYC_APPROVE, denied: P.FINANCE_APPROVE },
    { name: "Finance", permissions: [P.FINANCE_VIEW, P.FINANCE_RECONCILE], allowed: P.FINANCE_RECONCILE, denied: P.SUPPORT_RESOLVE },
    { name: "Operations", permissions: [P.DELIVERY_VIEW, P.DELIVERY_ASSIGN], allowed: P.DELIVERY_ASSIGN, denied: P.FINANCE_RECONCILE },
  ];
  for (const scenario of scenarios) {
    const allowed = responseRecorder();
    let allowedNext = false;
    requirePermission(scenario.allowed)(
      { staffAccess: { isHeadOffice: false, permissions: scenario.permissions } },
      allowed,
      () => { allowedNext = true; },
    );
    assert.equal(allowedNext, true, `${scenario.name} should access its own module`);

    const denied = responseRecorder();
    requirePermission(scenario.denied)(
      { staffAccess: { isHeadOffice: false, permissions: scenario.permissions } },
      denied,
      () => {},
    );
    assert.equal(denied.result.statusCode, 403, `${scenario.name} must not access another module`);
  }
});
