const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRole, adminOnly } = require("../middleware/auth.middleware");
const FintechCase = require("../models/fintechCase.model");
const RiskAlert = require("../models/riskAlert.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

test("admin role normalization accepts canonical Head Office spelling", () => {
  assert.equal(normalizeRole(" head-office "), "HEAD_OFFICE");
});

test("adminOnly only admits Head Office for fintech router", () => {
  let called = false;
  const middleware = adminOnly("HEAD_OFFICE");
  middleware({ user: { _id: "u1", role: "STATE_MANAGER" } }, { status: (code) => ({ json: (body) => ({ code, body }) }) }, () => { called = true; });
  assert.equal(called, false);
});

test("fintech case schema requires unique idempotency and reference fields", () => {
  assert.equal(FintechCase.schema.path("idempotencyKey").options.unique, true);
  assert.equal(FintechCase.schema.path("caseReference").options.unique, true);
  assert.equal(FintechCase.schema.path("notes").schema.path("body").options.required, true);
});

test("risk alerts require idempotency and deduplicate transaction plus kind", () => {
  assert.equal(RiskAlert.schema.path("idempotencyKey").options.unique, true);
  assert.ok(RiskAlert.schema.indexes().some(([keys, options]) =>
    keys.transaction === 1 && keys.kind === 1 && options.unique === true));
});

test("audit model registers fintech actions and immutable bulk guard", () => {
  assert.ok(AdminAuditLog.schema.path("action").enumValues.includes("SCHEDULED_PAYMENT_UPDATED"));
  assert.ok(AdminAuditLog.schema.s.hooks._pres.get("bulkWrite").length > 0);
});