const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../routes/businessPartner.routes");
const {
  STAFF_PERMISSIONS: P,
  STAFF_PERMISSION_VALUES,
} = require("../config/staffPermissions");

function permissionGuard(path, method) {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === path &&
      entry.route?.methods?.[method.toLowerCase()]
  );
  assert.ok(layer, `${method} ${path} route must exist`);
  assert.equal(layer.route.stack.length >= 4, true);
  return layer.route.stack[2].handle;
}

function runGuard(guard, staffAccess) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve({ allowed: false, statusCode: this.statusCode, body });
      },
    };
    guard({ staffAccess }, response, () => {
      resolve({ allowed: true, statusCode: 200, body: null });
    });
  });
}

test("Business Partner permissions use the shared staff catalog", () => {
  const expected = [
    P.BUSINESS_PARTNERS_VIEW,
    P.BUSINESS_PARTNERS_CREATE,
    P.BUSINESS_PARTNERS_UPDATE,
    P.BUSINESS_PARTNERS_STATUS,
    P.BUSINESS_PARTNERS_ASSIGN,
  ];

  assert.deepEqual(expected, [
    "business_partners.view",
    "business_partners.create",
    "business_partners.update",
    "business_partners.status",
    "business_partners.assign",
  ]);
  expected.forEach((permission) => {
    assert.equal(STAFF_PERMISSION_VALUES.includes(permission), true);
  });
});

test("Business Partner admin routes require matching permissions", async () => {
  const cases = [
    ["GET", "/admin/partners", P.BUSINESS_PARTNERS_VIEW],
    ["GET", "/admin/partners/count", P.BUSINESS_PARTNERS_VIEW],
    ["GET", "/admin/partners/:partnerId", P.BUSINESS_PARTNERS_VIEW],
    ["POST", "/admin/partners", P.BUSINESS_PARTNERS_CREATE],
    ["PATCH", "/admin/partners/:partnerId", P.BUSINESS_PARTNERS_UPDATE],
    ["PATCH", "/admin/partners/:partnerId/status", P.BUSINESS_PARTNERS_STATUS],
    [
      "POST",
      "/admin/partners/:partnerId/applications/:applicationId/assign",
      P.BUSINESS_PARTNERS_ASSIGN,
    ],
  ];

  for (const [method, path, permission] of cases) {
    const result = await runGuard(permissionGuard(path, method), {
      isHeadOffice: false,
      permissions: [],
    });
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.requiredPermission, permission);
  }
});

test("Head Office bypasses and authorized staff pass route guards", async () => {
  const viewGuard = permissionGuard("/admin/partners", "GET");
  const statusGuard = permissionGuard(
    "/admin/partners/:partnerId/status",
    "PATCH"
  );

  assert.equal(
    (await runGuard(viewGuard, {
      isHeadOffice: true,
      permissions: [],
    })).allowed,
    true
  );
  assert.equal(
    (await runGuard(viewGuard, {
      isHeadOffice: false,
      permissions: [P.BUSINESS_PARTNERS_VIEW],
    })).allowed,
    true
  );
  assert.equal(
    (await runGuard(statusGuard, {
      isHeadOffice: false,
      permissions: [P.BUSINESS_PARTNERS_STATUS],
    })).allowed,
    true
  );
});