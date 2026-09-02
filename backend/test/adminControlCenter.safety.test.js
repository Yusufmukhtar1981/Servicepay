const test = require("node:test");
const assert = require("node:assert/strict");

const controlCenter = require("../controllers/adminControlCenter.controller");
const { STAFF_PERMISSIONS } = require("../config/permissionRegistry");
const Transaction = require("../models/transaction.model");

const models = [
  require("../models/marketplaceOrder.model"),
  require("../models/delivery.model"),
  require("../models/solarApplication.model"),
  require("../models/phoneApplication.model"),
  require("../models/phoneFinance.model"),
  require("../models/phonePayment.model"),
  require("../models/empowermentProgram.model"),
  require("../models/empowermentFunding.model"),
  require("../models/empowermentDisbursement.model"),
  require("../models/amanaOrder.model"),
  require("../models/withdrawalRequest.model"),
];

test("every declared operational enum state has exactly one exhaustive bucket", () => {
  for (const Model of models) {
    const taxonomy = controlCenter.OPERATIONAL_TAXONOMIES[Model.modelName];
    assert.ok(taxonomy, `${Model.modelName} taxonomy is declared`);
    const states = Model.schema.path(taxonomy.statusField).enumValues;
    for (const state of states) {
      const memberships = ["success", "pending", "failed"]
        .filter((bucket) => taxonomy[bucket].includes(state));
      assert.equal(memberships.length, 1, `${Model.modelName}:${state} has one class`);
      assert.equal(controlCenter.classifyOperationalStatus(taxonomy, state), memberships[0]);
    }
    assert.equal(controlCenter.classifyOperationalStatus(taxonomy, "__UNKNOWN__"), "other");
  }
});

test("PII response sanitizer masks recursively and never exposes sessions", () => {
  const result = controlCenter.maskSensitiveResponse({
    identifier: "person@example.com", ipAddress: "203.0.113.9",
    metadata: { email: "person@example.com", nested: { phone: "08012345678", sessionReference: "secret-session" } },
  });
  assert.notEqual(result.identifier, "person@example.com");
  assert.notEqual(result.ipAddress, "203.0.113.9");
  assert.notEqual(result.metadata.email, "person@example.com");
  assert.notEqual(result.metadata.nested.phone, "08012345678");
  assert.equal("sessionReference" in result.metadata.nested, false);
});

test("Transaction status taxonomy is exhaustive, exclusive, and keeps refunds distinct", () => {
  const taxonomy = controlCenter.TRANSACTION_STATUS_TAXONOMY;
  const states = Transaction.schema.path("status").enumValues;
  for (const state of states) {
    const memberships = Object.keys(taxonomy).filter((bucket) => taxonomy[bucket].includes(state));
    assert.equal(memberships.length, 1, `${state} has exactly one transaction bucket`);
    assert.equal(controlCenter.classifyTransactionStatus(state), memberships[0]);
  }
  assert.deepEqual(taxonomy.refunded, ["REFUNDED"]);
  assert.equal(controlCenter.classifyTransactionStatus("__UNKNOWN__"), "other");
});

test("security management permission and canonical analytics metadata are declared", () => {
  assert.equal(STAFF_PERMISSIONS.AUDIT_MANAGE, "audit.manage");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "controllers/adminControlCenter.controller.js"), "utf8");
  const routes = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "routes/admin.routes.js"), "utf8");
  assert.match(routes, /security-events\/:id".*requirePermission\(P\.AUDIT_MANAGE\)/);
  assert.match(source, /unifiedTotalAvailable: false/);
  assert.match(source, /additive: false/);
  assert.match(source, /PhonePayment, "FINANCING_PAYMENTS"/);
  assert.match(source, /findOneAndUpdate/);
  assert.match(source, /ACKNOWLEDGE: \{ from: \["OPEN"\]/);
  assert.match(source, /RESOLVE: \{ from: \["ACKNOWLEDGED"\]/);
  assert.doesNotMatch(source, /RESOLVE: \{ from: \[[^\]]*"OPEN"/);
  assert.match(source, /REOPEN: \{ from: \["ACKNOWLEDGED", "RESOLVED"\]/);
});