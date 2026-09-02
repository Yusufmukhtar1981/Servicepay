const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const AdminAccessLog = require("../models/adminAccessLog.model");
const AdminExportHistory = require("../models/adminExportHistory.model");
const PrivacyRequest = require("../models/privacyRequest.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Branch = require("../models/branch.model");
const Delivery = require("../models/delivery.model");
const WithdrawalRequest = require("../models/withdrawalRequest.model");
const KycProfile = require("../models/kycProfile.model");
const MarketplaceOrder = require("../models/marketplaceOrder.model");
const SolarApplication = require("../models/solarApplication.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("control center registers the complete protected route contract", () => {
  const routes = read("routes/admin.routes.js");
  ["catalog", "audit-logs", "security-events", "access-logs", "exports/history",
    "exports/:dataset.csv", "readiness", "privacy-requests", "analytics/executive",
    "analytics/services", "analytics/transactions", "analytics/customers"].forEach((route) =>
    assert.match(routes, new RegExp(`control-center/${route.replace(/[./]/g, "\\$&")}`)));
  assert.match(routes, /router\.use\(adminAccessLog\)/);
  assert.match(routes, /adminOnly\("HEAD_OFFICE"\)/);
  assert.match(read("controllers/adminControlCenter.controller.js"), /exports\.catalog = \(req, res\) => res\.json\(\{ success: true, data: \[/);
});

test("access rows expire and export records preserve completion metadata", () => {
  assert.equal(AdminAccessLog.schema.path("expiresAt").options.index.expires, 0);
  ["status", "completedAt", "contentAvailable"].forEach((field) =>
    assert.ok(AdminExportHistory.schema.path(field)));
});

test("privacy workflow has constrained statuses and immutable audit actions exist", () => {
  assert.deepEqual(PrivacyRequest.schema.path("status").enumValues, ["OPEN", "IN_REVIEW", "COMPLETED", "REJECTED"]);
  const source = read("controllers/adminControlCenter.controller.js");
  assert.match(source, /span.*no more than 90 days/);
  assert.match(source, /String\(row\[key\]/);
  assert.match(source, /password\|token\|secret\|pin/);
  assert.match(source, /onError: 0/);
  assert.match(source, /ERASURE requests cannot be completed/);
  assert.match(source, /User\.exists\(\{ _id: subjectUser \}\)/);
  assert.match(source, /targetUserId targetUserName action reason requestMethod/);
  assert.match(source, /p > 100/);
  assert.match(source, /AUDIT_LOGS: "AUDIT"/);
  assert.match(source, /req\.body\.note \?\? req\.body\.resolutionNote/);
  assert.match(source, /T23:59:59\.999Z/);
  [User, Transaction, Branch, Delivery, WithdrawalRequest, KycProfile,
    MarketplaceOrder, SolarApplication, LoginSecurityEvent, PrivacyRequest].forEach((Model) => {
    const standalone = Model.schema.indexes().filter(([keys]) =>
      Object.keys(keys).length === 1 && keys.createdAt === -1);
    assert.equal(standalone.length, 1, `${Model.modelName} needs exactly one standalone descending createdAt index`);
  });
});

test("control center wires real operational models and safe operational contracts", () => {
  const source = read("controllers/adminControlCenter.controller.js");
  const routes = read("routes/admin.routes.js");
  ["PhoneApplication", "PhoneFinance", "PhonePayment", "EmpowermentProgram",
    "EmpowermentFunding", "EmpowermentDisbursement", "AmanaOrder"].forEach((model) =>
    assert.match(source, new RegExp(`const ${model} = require`)));
  ["FINANCING: [PhoneFinance", "EMPOWERMENT: [EmpowermentDisbursement",
    "AMANA: [AmanaOrder", "operationalRollup", "activeRiders", "walletBalance",
    "transactionActiveCustomers", "pagination"].forEach((contract) =>
    assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(routes, /patch\("\/control-center\/security-events\/:id"/);
  ["eventType", "severity", "workflowStatus", "acknowledgedAt", "resolvedAt",
    "investigationNote"].forEach((field) => assert.ok(LoginSecurityEvent.schema.path(field)));
});

test("readiness and analytics do not claim fake backup or provider checks", () => {
  const source = read("controllers/adminControlCenter.controller.js");
  assert.match(source, /manualBackupSupported: false/);
  assert.match(source, /PROVIDER_MANAGED/);
  assert.match(source, /NOT_LIVE_CHECKED/);
  assert.match(source, /Boolean\(process\.env\.PAYSTACK_SECRET_KEY\)/);
  assert.match(source, /PhoneFinance/);
  assert.match(source, /AmanaOrder/);
});