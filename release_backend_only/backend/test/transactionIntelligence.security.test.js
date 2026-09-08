const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../routes/admin.routes");
const {
  STAFF_PERMISSIONS: P,
  STAFF_PERMISSION_VALUES,
} = require("../config/staffPermissions");
const {
  __test: {
    lagosRange,
    maskPhone,
    maskEmail,
    sanitizePayload,
    normalizeProviderStatus,
    normalizeInternalStatus,
    intelligenceFor,
  },
} = require("../controllers/adminTransactionIntelligence.controller");

const routeGuard = (path, method) => {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === path &&
      entry.route?.methods?.[method.toLowerCase()]
  );
  assert.ok(layer, `${method} ${path} must exist`);
  return layer.route.stack[2].handle;
};

const runGuard = (guard, staffAccess) => new Promise((resolve) => {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      resolve({ allowed: false, statusCode: this.statusCode, body });
    },
  };
  guard({ staffAccess }, response, () => resolve({ allowed: true }));
});

test("Transaction Intelligence permissions are in the shared catalog", () => {
  const expected = [
    P.TRANSACTION_INTELLIGENCE_VIEW,
    P.TRANSACTION_INTELLIGENCE_REQUERY,
    P.TRANSACTION_INTELLIGENCE_RECONCILE,
    P.TRANSACTION_INTELLIGENCE_EXPORT,
    P.TRANSACTION_INTELLIGENCE_PROVIDER_HEALTH,
  ];
  assert.deepEqual(expected, [
    "transaction_intelligence.view",
    "transaction_intelligence.requery",
    "transaction_intelligence.reconcile",
    "transaction_intelligence.export",
    "transaction_intelligence.provider_health",
  ]);
  expected.forEach((permission) => {
    assert.equal(STAFF_PERMISSION_VALUES.includes(permission), true);
  });
});

test("read, requery, provider health, and export routes enforce separate permissions", async () => {
  const cases = [
    ["GET", "/transaction-intelligence/summary", P.TRANSACTION_INTELLIGENCE_VIEW],
    ["GET", "/transaction-intelligence/transactions", P.TRANSACTION_INTELLIGENCE_VIEW],
    ["GET", "/transaction-intelligence/queue", P.TRANSACTION_INTELLIGENCE_VIEW],
    ["GET", "/transaction-intelligence/providers", P.TRANSACTION_INTELLIGENCE_PROVIDER_HEALTH],
    ["POST", "/transaction-intelligence/transactions/:transactionId/requery", P.TRANSACTION_INTELLIGENCE_REQUERY],
    ["POST", "/transaction-intelligence/export.csv", P.TRANSACTION_INTELLIGENCE_EXPORT],
  ];
  for (const [method, path, permission] of cases) {
    const denied = await runGuard(routeGuard(path, method), {
      isHeadOffice: false,
      permissions: [],
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.requiredPermission, permission);

    const allowed = await runGuard(routeGuard(path, method), {
      isHeadOffice: false,
      permissions: [permission],
    });
    assert.equal(allowed.allowed, true);
  }
});

test("provider payload redaction recursively removes credentials and identity secrets", () => {
  const safe = sanitizePayload({
    status: "ORDER_COMPLETED",
    orderId: "ORDER-1",
    token: "secret-token",
    nested: {
      apiKey: "secret-key",
      pin: "1234",
      bvn: "12345678901",
      message: "Delivered",
    },
  });
  assert.equal(safe.status, "ORDER_COMPLETED");
  assert.equal(safe.orderId, "ORDER-1");
  assert.equal(safe.token, "[REDACTED]");
  assert.equal(safe.nested.apiKey, "[REDACTED]");
  assert.equal(safe.nested.pin, "[REDACTED]");
  assert.equal(safe.nested.bvn, "[REDACTED]");
  assert.equal(safe.nested.message, "Delivered");
});

test("normalization preserves uncertainty and never invents success", () => {
  assert.equal(normalizeProviderStatus("ORDER_COMPLETED"), "SUCCESSFUL");
  assert.equal(normalizeProviderStatus("ORDER_CANCELLED"), "FAILED");
  assert.equal(normalizeProviderStatus("UNSUCCESSFUL"), "UNKNOWN");
  assert.equal(normalizeProviderStatus("NOT_SUCCESSFUL"), "UNKNOWN");
  assert.equal(normalizeProviderStatus("200"), "UNKNOWN");
  assert.equal(normalizeProviderStatus("00"), "UNKNOWN");
  assert.equal(normalizeProviderStatus("something-new"), "UNKNOWN");
  assert.equal(normalizeInternalStatus("mystery"), "UNKNOWN");

  const pending = intelligenceFor({
    status: "PENDING",
    provider: "CLUBKONNECT",
    providerResponse: { status: "unrecognized" },
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  assert.equal(pending.internalStatus, "PENDING");
  assert.equal(pending.providerStatus, "UNKNOWN");
  assert.equal(pending.requiresReview, true);
  assert.notEqual(pending.internalStatus, "SUCCESSFUL");

  const transportSuccessBusinessFailure = intelligenceFor({
    status: "PENDING",
    provider: "UNKNOWN_PROVIDER",
    providerResponse: { status: 200, code: "00", data: { status: "FAILED" } },
    createdAt: new Date(),
  });
  assert.equal(transportSuccessBusinessFailure.providerStatus, "UNKNOWN");
  assert.notEqual(transportSuccessBusinessFailure.providerStatus, "SUCCESSFUL");
});

test("mismatch detection requires review without changing raw states", () => {
  const transaction = {
    status: "FAILED",
    provider: "CLUBKONNECT",
    providerResponse: {
      transactionStatus: "ORDER_COMPLETED",
      orderId: "PROVIDER-1",
    },
    createdAt: new Date(),
  };
  const result = intelligenceFor(transaction);
  assert.equal(transaction.status, "FAILED");
  assert.equal(transaction.providerResponse.transactionStatus, "ORDER_COMPLETED");
  assert.equal(result.providerStatus, "SUCCESSFUL");
  assert.equal(result.internalStatus, "FAILED");
  assert.equal(result.reconciliationStatus, "RECONCILIATION_REQUIRED");
  assert.equal(
    result.signals.some((signal) => signal.code === "PROVIDER_SUCCESS_INTERNAL_INCOMPLETE"),
    true
  );
});

test("masking and Africa/Lagos day boundaries are deterministic", () => {
  assert.match(maskPhone("08012345678"), /^080\*+678$/);
  assert.equal(maskEmail("customer@example.com").endsWith("@example.com"), true);
  const range = lagosRange("2026-08-30");
  assert.equal(range.start.toISOString(), "2026-08-29T23:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-08-30T23:00:00.000Z");
});