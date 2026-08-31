const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { evaluate, severityFor, defaults } = require("../services/riskEvaluator.service");

test("risk evaluator keeps normal observed evidence at zero risk", () => {
  const result = evaluate({ code: "VELOCITY", score: 60 }, { recentTransactionCount: 1 });
  assert.equal(result.triggered, false);
  assert.equal(result.score, 0);
  assert.deepEqual(result.reasons, []);
});
test("velocity has conservative configured threshold and an exact reason", () => {
  const count = defaults.VELOCITY.count;
  assert.equal(evaluate({ code: "VELOCITY", score: 60 }, { recentTransactionCount: count - 1 }).triggered, false);
  const result = evaluate({ code: "VELOCITY", score: 60 }, { recentTransactionCount: count });
  assert.equal(result.triggered, true);
  assert.equal(result.reasons[0].code, "VELOCITY");
  assert.match(result.reasons[0].text, /threshold/);
});
test("amount anomaly requires sufficient bounded history", () => {
  const rule = { code: "AMOUNT_ANOMALY", score: 55 };
  assert.equal(evaluate(rule, { amount: 1000, historyAverage: 100, historyCount: 4 }).triggered, false);
  assert.equal(evaluate(rule, { amount: 400, historyAverage: 100, historyCount: 5 }).triggered, true);
});
test("rapid wallet in/out requires observed material movement on both sides", () => {
  const rule = { code: "RAPID_WALLET_IN_OUT", score: 70 };
  assert.equal(evaluate(rule, { walletInAmount: 10000, walletOutAmount: 1 }).triggered, false);
  assert.equal(evaluate(rule, { walletInAmount: 10000, walletOutAmount: 10000 }).triggered, true);
});
test("severity bands are deterministic", () => {
  assert.equal(severityFor(0), "LOW");
  assert.equal(severityFor(35), "MEDIUM");
  assert.equal(severityFor(60), "HIGH");
  assert.equal(severityFor(80), "CRITICAL");
});
test("fraud-risk implementation retains monitoring-first safety contracts", () => {
  const registry = fs.readFileSync(require.resolve("../config/permissionRegistry"), "utf8");
  const routes = fs.readFileSync(require.resolve("../routes/admin.routes"), "utf8");
  const controller = fs.readFileSync(require.resolve("../controllers/adminFraudRisk.controller"), "utf8");
  const alert = fs.readFileSync(require.resolve("../models/riskAlert.model"), "utf8");
  const runner = fs.readFileSync(require.resolve("../services/riskEvaluationRunner.service"), "utf8");
  assert.match(registry, /fraud_risk\.view/);
  assert.match(registry, /fraud_risk\.restrict/);
  assert.match(routes, /router\.post\("\/fraud-risk\/export\.csv"/);
  assert.match(controller, /An export reason is required/);
  assert.match(controller, /PHASE_1_RESTRICTION_UNSUPPORTED/);
  assert.match(controller, /mutationVersion are required/);
  assert.match(controller, /FINTECH_OPERATION/);
  assert.match(controller, /maskPhone/);
  assert.match(controller, /maskName/);
  assert.match(controller, /customerZone/);
  assert.match(controller, /customerBusinessPartner/);
  assert.match(controller, /alertScope/);
  assert.doesNotMatch(controller, /scopedCustomerIds/);
  assert.doesNotMatch(controller, /5001|scope is too broad/);
  assert.doesNotMatch(controller, /q\.customer\s*=\s*q\.customer\s*\|\|/);
  assert.match(controller, /\$and: \[alertScope\(req\), requested\]/);
  assert.match(controller, /findOne\(\{ \$and: \[\{ _id: req\.params\.alertId \}, alertScope\(req\)\] \}\)/);
  assert.doesNotMatch(controller, /isUserWithinScope\(req\.staffAccess, a\.customer\)/);
  assert.match(controller, /scopeType: "GLOBAL"/);
  assert.match(controller, /withTransaction/);
  assert.match(controller, /Idempotency-Key/);
  assert.match(controller, /assignedTo must be a valid/);
  assert.match(controller, /RiskRuleCommand/);
  assert.match(controller, /providerConcentration/);
  assert.match(controller, /serviceConcentration/);
  assert.doesNotMatch(controller, /amountUnderReview:\s*0/);
  assert.match(controller, /alertCount/);
  assert.match(controller, /Unable to evaluate transaction risk/);
  assert.match(controller, /evaluateTransaction\(tx\._id, \{ session \}\)/);
  assert.match(controller, /RISK_EVALUATION[\s\S]*session/);
  assert.match(runner, /ensureDefaultRules\(session\)/);
  assert.match(runner, /setDefaultsOnInsert: true,[\s\S]*session/);
  assert.match(runner, /customerZone: customer\.zone/);
  assert.doesNotMatch(runner, /Promise\.all/);
  assert.doesNotMatch(controller, /walletBalance\s*[:+]?=/);
  assert.match(alert, /identity.*unique: true/);
});