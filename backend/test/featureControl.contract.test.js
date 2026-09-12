const test = require("node:test");
const assert = require("node:assert/strict");

const AppSettings = require("../models/appSettings.model");
const {
  FEATURE_REGISTRY,
  currentFeature,
  currentRegistry,
  registry,
  customer,
  canProtectedManage,
} = require("../controllers/featureControl.controller");
const {
  featureState,
  requireFeatureEnabled,
} = require("../middleware/fintechControl.middleware");
const {
  FEATURE_ROUTE_REGISTRY,
  featureBindingsForRequest,
} = require("../config/featureRouteRegistry");

const response = () => {
  const result = {};
  return {
    result,
    res: {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    },
  };
};

test("only ServicePay super admin inherits protected feature permission", () => {
  const permission = "feature_control.protected_manage";
  assert.equal(
    canProtectedManage({ user: { role: "SERVICEPAY_SUPER_ADMIN" } }),
    true
  );
  assert.equal(
    canProtectedManage({
      user: { role: "SUPER_ADMIN" },
      staffAccess: { permissions: ["*"] },
    }),
    false
  );
  assert.equal(
    canProtectedManage({
      user: { role: "HEAD_OFFICE" },
      staffAccess: { permissions: ["*"] },
    }),
    false
  );
  assert.equal(
    canProtectedManage({
      user: { role: "OPERATIONS_MANAGER" },
      staffAccess: { permissions: ["feature_control.manage"] },
    }),
    false
  );
  assert.equal(
    canProtectedManage({
      user: { role: "SUPER_ADMIN" },
      staffAccess: { permissions: [permission] },
    }),
    true
  );
});

test("canonical registry covers customer features and missing state defaults ON/visible", () => {
  assert.ok(FEATURE_REGISTRY.some(([key]) => key === "airtime"));
  assert.ok(FEATURE_REGISTRY.some(([key]) => key === "servicepayTransfer"));
  assert.ok(FEATURE_REGISTRY.some(([key]) => key === "marketplace"));
  const feature = currentFeature({}, ["newFeature", "New Feature", "Test", "A safe default"]);
  assert.equal(feature.enabled, true);
  assert.equal(feature.effectiveEnabled, true);
  assert.equal(feature.visible, true);
  assert.equal(currentRegistry({}).length, FEATURE_REGISTRY.length);
});

test("route registry binds only mutating customer entry points", () => {
  for (const key of [
    "wallet",
    "organizationWithdrawals",
    "storePosting",
    "programSponsor",
    "transport",
    "aiSupport",
    "referral",
  ]) {
    assert.ok(FEATURE_ROUTE_REGISTRY.some((binding) => binding.key === key), key);
  }
  assert.deepEqual(
    featureBindingsForRequest({ method: "GET", originalUrl: "/api/ai-support/history" }),
    []
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/transfer/bank/requery" }),
    []
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/ai-support/chat" }),
    ["aiSupport"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/organizations/org-1/withdrawals" }),
    ["organizationWithdrawals"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/id-verification/nin" }),
    ["ninVerification"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/id-verification/bvn" }),
    ["bvnVerification"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/id-verification/nin/history" }),
    []
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/id-verification/bvn/history" }),
    []
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/electricity/verify-meter" }),
    ["electricity"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/marketplace/orders" }),
    ["marketplace"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/paystack/initialize" }),
    ["walletFunding"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/paystack/verify" }),
    []
  );
  for (const path of [
    "/api/marketplace/orders/1/confirm-delivery",
    "/api/marketplace/seller/orders/1/status",
    "/api/organizations/org-1/withdrawals/withdrawal-1/reject",
    "/api/organizations/org-1/withdrawals/withdrawal-1/requery",
    "/api/organizations/org-1/withdrawals/withdrawal-1/recovery",
    "/api/electricity/callback",
  ]) {
    assert.deepEqual(featureBindingsForRequest({ method: "POST", originalUrl: path }), [], path);
  }
  for (const path of [
    "/api/empowerment/programs/program-1/disbursements",
    "/api/empowerment/programs/program-1/bulk-disbursement",
    "/api/empowerment/programs/program-1/beneficiaries/beneficiary-1/pay",
    "/api/empowerment/programs/program-1/beneficiaries/beneficiary-1/disbursement",
  ]) {
    assert.deepEqual(
      featureBindingsForRequest({ method: "POST", originalUrl: path }),
      ["programSponsor"],
      path
    );
  }
  for (const [method, path] of [
    ["GET", "/api/empowerment/programs/program-1/disbursements"],
    ["POST", "/api/empowerment/programs/program-1/disbursement-preview"],
    ["GET", "/api/empowerment/programs/program-1/disbursement-batches"],
    ["POST", "/api/empowerment/disbursement-batches/batch-1/prepare"],
    ["POST", "/api/empowerment/programs/program-1/fund"],
    ["POST", "/api/empowerment/programs/program-1/fund"],
    ["POST", "/api/empowerment/programs/program-1/beneficiaries/beneficiary-1/recovery"],
  ]) {
    assert.deepEqual(featureBindingsForRequest({ method, originalUrl: path }), [], `${method} ${path}`);
  }
  assert.deepEqual(
    featureBindingsForRequest({
      method: "POST",
      originalUrl: "/api/empowerment/programs/program-1/apply",
    }),
    ["empowerment"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "POST", originalUrl: "/api/marketplace/products" }),
    ["storePosting"]
  );
  assert.deepEqual(
    featureBindingsForRequest({ method: "PATCH", originalUrl: "/api/marketplace/products/1" }),
    ["storePosting"]
  );
  assert.deepEqual(
    featureBindingsForRequest({
      method: "POST",
      originalUrl: "/api/organizations/org-1/withdrawals/withdrawal-1/approve",
    }),
    ["organizationWithdrawals"]
  );
  for (const path of [
    "/api/organizations/org-1/payments",
    "/api/organizations/org-1/annual-payment",
    "/api/organizations/org-1/fee-assignments/assignment-1/pay",
  ]) {
    assert.deepEqual(
      featureBindingsForRequest({ method: "POST", originalUrl: path }),
      ["organizations"],
      path
    );
  }
  for (const path of [
    "/api/organizations/org-1/payments/requery",
    "/api/organizations/org-1/payments/reject",
    "/api/organizations/org-1/payments/status",
  ]) {
    assert.deepEqual(
      featureBindingsForRequest({ method: "POST", originalUrl: path }),
      [],
      path
    );
  }
  for (const path of [
    "/api/delivery/pay/1",
    "/api/logistics/interstate/shipments/1/pay",
    "/api/logistics/interstate/shipments",
  ]) {
    assert.deepEqual(featureBindingsForRequest({ method: "POST", originalUrl: path }), ["delivery"]);
  }
  for (const path of [
    "/api/delivery/cancel/1",
    "/api/logistics/interstate/shipments/1/cancel",
    "/api/logistics/interstate/shipments/1/confirm-delivery",
  ]) {
    assert.deepEqual(featureBindingsForRequest({ method: "POST", originalUrl: path }), [], path);
  }
});

test("scheduled state uses the latest due event and preserves future schedules", () => {
  const now = new Date("2026-01-01T04:00:00.000Z");
  const definition = ["data", "Data", "Payments", "Data", null];
  const disabled = currentFeature({
    fintechControl: {
      featureRegistry: {
        data: {
          enabled: true,
          scheduledDisabledAt: new Date("2026-01-01T02:00:00.000Z"),
          scheduledEnabledAt: new Date("2026-01-01T03:00:00.000Z"),
        },
      },
    },
  }, definition, now);
  assert.equal(disabled.effectiveEnabled, true);

  const future = currentFeature({
    fintechControl: {
      featureRegistry: {
        data: {
          enabled: true,
          scheduledDisabledAt: new Date("2026-01-01T05:00:00.000Z"),
        },
      },
    },
  }, definition, now);
  assert.equal(future.effectiveEnabled, true);
});

test("canonical enforcement returns controlled disabled and maintenance responses", async () => {
  const disabled = {};
  await new Promise((resolve) => requireFeatureEnabled("data")(
    { fintechControl: { featureRegistry: { data: { enabled: false } } } },
    {
      status(code) {
        disabled.status = code;
        return this;
      },
      json(body) {
        disabled.body = body;
        resolve();
      },
    },
    () => resolve()
  ));
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.code, "FEATURE_DISABLED");

  const maintenance = {};
  await new Promise((resolve) => requireFeatureEnabled("data")(
    { fintechControl: { featureRegistry: { data: {
      enabled: true,
      maintenanceMode: true,
      maintenanceTitle: "Planned maintenance",
      maintenanceMessage: "Back at 03:00.",
    } } } },
    {
      status(code) {
        maintenance.status = code;
        return this;
      },
      json(body) {
        maintenance.body = body;
        resolve();
      },
    },
    () => resolve()
  ));
  assert.equal(maintenance.status, 503);
  assert.equal(maintenance.body.code, "FEATURE_MAINTENANCE");
  assert.equal(maintenance.body.message, "Back at 03:00.");
});

test("customer configuration returns hidden features and admin registry remains complete", async () => {
  const original = AppSettings.getGlobalSettings;
  AppSettings.getGlobalSettings = async () => ({
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    services: { airtime: true },
    fintechControl: {
      featureRegistry: {
        airtime: { enabled: true, visible: false },
        data: { enabled: false, visible: true },
      },
    },
  });
  try {
    const customerResponse = response();
    await customer({}, customerResponse.res);
    const hidden = customerResponse.result.body.features.find((item) => item.key === "airtime");
    assert.equal(hidden.visible, false);
    assert.equal(hidden.enabled, true);
    assert.equal(customerResponse.result.body.features.find((item) => item.key === "data").enabled, false);

    const adminResponse = response();
    await registry({}, adminResponse.res);
    assert.equal(adminResponse.result.body.features.length, FEATURE_REGISTRY.length);
    assert.equal(adminResponse.result.body.metrics.hidden, 1);
  } finally {
    AppSettings.getGlobalSettings = original;
  }
});
