"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../services/profitSharing.policy");
// Example administrator-entered values, not production defaults.
const percentages = {
  AGGREGATOR: 40, STATE_MANAGER: 35, ZONAL_MANAGER: 25,
};
const ids = [1, 2, 3, 4].map(n => n.toString(16).padStart(24, "0"));
const beneficiaries = Object.fromEntries(P.ROLES.map((role, i) =>
  [role, { id: ids[i], eligible: true }]));
const fixture = () => ({
  transaction: { id: "transaction-1", reference: "original-request-1",
    status: "SUCCESSFUL", settlementVerified: true, reversed: false,
    serviceType: "DATA", amountKobo: 100000, createdAt: "2026-12-02T00:00:00Z" },
  rule: { id: "immutable-rule-1", serviceType: "DATA", enabled: true,
    effectiveAt: "2026-12-01T00:00:00Z", percentages: { ...percentages },
    policyVersion: 2, poolPercentage: 50 },
  costs: { verified: true, evidenceReference: "verified-provider-invoice-1",
    customerAmountKobo: 100000, providerCostKobo: 80000,
    directCostsKobo: 1000, otherApprovedCostsKobo: 1000,
    otherCostsApprovalReference: "approved-cost-1" },
  beneficiaries: structuredClone(beneficiaries),
});

test("approved template has exactly three hierarchy roles and totals exactly 100%", () => {
  assert.deepEqual(P.ROLES, ["AGGREGATOR", "STATE_MANAGER", "ZONAL_MANAGER"]);
  assert.deepEqual(P.ALLOCATION_SUGGESTION, percentages);
  assert.equal(percentages.AGGREGATOR, 40);
  assert.equal(Object.values(P.percentageBasisPoints(percentages)).reduce((a, b) => a + b), 10000);
  assert.equal(P.ROLES.includes("BRM"), false);
  assert.equal(P.ROLES.includes("CM"), false);
});
test("rejects incorrect totals, fabricated roles, strings and excessive precision", () => {
  for (const value of [
    { ...percentages, ZONAL_MANAGER: 24.99 },
    { ...percentages, HEAD_OFFICE: 0 },
    { ...percentages, CM: 0 },
    { ...percentages, AGGREGATOR: "20" },
    { ...percentages, AGGREGATOR: -20 },
    { ...percentages, AGGREGATOR: 20.001 },
    { ...percentages, AGGREGATOR: NaN },
    { ...percentages, AGGREGATOR: Infinity },
  ]) assert.throws(() => P.percentageBasisPoints(value));
});
test("allows configurable percentage precision up to two decimal places", () => {
  const value = { ...percentages, AGGREGATOR: 39.99, ZONAL_MANAGER: 25.01 };
  assert.equal(P.percentageBasisPoints(value).AGGREGATOR, 3999);
});
test("explicit service pool splits verified net profit and keeps company profit outside commissions", () => {
  const value = P.plan(fixture());
  assert.equal(value.netProfitKobo, 18000);
  assert.equal(value.poolKobo, 9000);
  assert.equal(value.companyRetainedKobo, 9000);
  assert.deepEqual(value.allocations.map(row => row.amountKobo), [3600, 3150, 2250]);
  assert.equal(value.companyRetainedKobo + value.beneficiaryKobo, 18000);
});
test("zero and negative profits create no entitlement", () => {
  for (const cost of [98000, 120000]) {
    const input = fixture(); input.costs.providerCostKobo = cost;
    assert.deepEqual(P.plan(input), { eligible: false, reason: "NO_POSITIVE_NET_PROFIT" });
  }
});
test("missing/unverified provider costs and unapproved costs fail closed", () => {
  for (const patch of [
    { verified: false }, { evidenceReference: "" }, { providerCostKobo: undefined },
    { directCostsKobo: undefined }, { otherCostsApprovalReference: "" },
    { providerCostKobo: -1 }, { providerCostKobo: 1.5 },
  ]) {
    const input = fixture(); Object.assign(input.costs, patch);
    assert.throws(() => P.plan(input));
  }
});
test("cost evidence must match original transaction amount", () => {
  const input = fixture(); input.costs.customerAmountKobo += 1;
  assert.throws(() => P.plan(input), { code: "COST_TRANSACTION_AMOUNT_MISMATCH" });
});
test("pending, failed, refunded and unverified success earn nothing", () => {
  for (const status of ["PENDING", "FAILED", "REFUNDED", "UNKNOWN"]) {
    const input = fixture(); input.transaction.status = status;
    assert.equal(P.plan(input).eligible, false);
  }
  for (const patch of [{ settlementVerified: false }, { reversed: true }]) {
    const input = fixture(); Object.assign(input.transaction, patch);
    assert.equal(P.plan(input).eligible, false);
  }
});
test("missing/ineligible hierarchy shares remain unallocated commission, never company profit", () => {
  const input = fixture();
  delete input.beneficiaries.AGGREGATOR;
  input.beneficiaries.STATE_MANAGER.eligible = false;
  const result = P.plan(input);
  assert.equal(result.unallocatedKobo, 6750);
  assert.equal(result.allocations[0].amountKobo, 3600);
  assert.equal(result.companyRetainedKobo, 9000);
  assert.equal(result.beneficiaryKobo, 2250);
});
test("duplicate hierarchy identities receive one share, never stacked shares", () => {
  const input = fixture(); input.beneficiaries.STATE_MANAGER.id = ids[0];
  const result = P.plan(input);
  assert.equal(result.unallocatedKobo, 3150);
  assert.equal(result.allocations[1].beneficiaryId, null);
});
test("invalid beneficiary identity remains unallocated", () => {
  const input = fixture(); input.beneficiaries.AGGREGATOR.id = "fake-user";
  assert.equal(P.plan(input).unallocatedKobo, 3600);
});
test("future-effective and service-specific rules preserve earlier sales", () => {
  const input = fixture();
  input.transaction.createdAt = "2026-11-30T23:59:59Z";
  assert.equal(P.plan(input).reason, "BEFORE_RULE_EFFECTIVE_DATE");
  input.transaction.createdAt = "2026-12-02T00:00:00Z";
  input.rule.serviceType = "AIRTIME";
  assert.equal(P.plan(input).reason, "SERVICE_MISMATCH");
  input.rule.enabled = false;
  assert.equal(P.plan(input).reason, "DISTRIBUTION_PAUSED");
});
test("rule creation rejects retroactive dates and copies caller-owned percentages", () => {
  const input = fixture();
  assert.throws(() => P.validateRule(input.rule, "2026-12-02T00:00:00Z"),
    { code: "RULE_MUST_BE_FUTURE_EFFECTIVE" });
  const result = P.validateRule(input.rule, "2026-11-30T00:00:00Z");
  input.rule.percentages.AGGREGATOR = 90;
  assert.equal(result.percentages.AGGREGATOR, 40);
});
test("replay returns stable event key and does not mutate source inputs", () => {
  const input = fixture(), before = structuredClone(input);
  assert.deepEqual(P.plan(input), P.plan(input));
  assert.deepEqual(input, before);
  assert.equal(P.plan(input).eventKey, "profit-sharing:transaction-1");
  // Planning is deterministic, not a claim of database-enforced idempotency.
});
test("integer-kobo rounding conserves every kobo for small and large pools", () => {
  for (const pool of [0, 1, 2, 3, 7, 19, 101, 10001, 123456789, Number.MAX_SAFE_INTEGER]) {
    const result = P.allocate(pool, percentages, beneficiaries);
    assert.equal(result.unallocatedKobo + result.roundingKobo + result.beneficiaryKobo, pool);
    assert.ok(result.roundingKobo >= 0 && result.roundingKobo < P.ROLES.length);
    assert.equal(result.allocations.reduce((a, row) => a + row.amountKobo, 0) + result.roundingKobo, pool);
  }
});
test("no missing cost component silently defaults to zero", () => {
  for (const key of ["customerAmountKobo", "providerCostKobo", "directCostsKobo", "otherApprovedCostsKobo"]) {
    const costs = fixture().costs; delete costs[key];
    assert.throws(() => P.profitPool(costs));
  }
});
test("pool is mandatory, precise and never inferred from old five-role rules", () => {
  for (const poolPercentage of [undefined, null, "50", -1, 100.01, 1.001, NaN, Infinity]) {
    const input = fixture(); input.rule.poolPercentage = poolPercentage;
    assert.throws(() => P.plan(input));
  }
  const old = fixture(); delete old.rule.policyVersion;
  const before = structuredClone(old);
  assert.throws(() => P.plan(old), { code: "THREE_ROLE_POLICY_V2_REQUIRED" });
  assert.deepEqual(old, before);
});
test("all approved pool sizes conserve net profit including rounding and absent hierarchy", () => {
  for (const poolPercentage of [0, 0.01, 33.33, 50, 99.99, 100]) {
    const input = fixture(); input.rule.poolPercentage = poolPercentage;
    input.costs.providerCostKobo = 80001; input.beneficiaries = {};
    const result = P.plan(input);
    assert.equal(result.netProfitKobo, result.companyRetainedKobo + result.poolKobo);
    if (result.eligible) {
      assert.equal(result.poolKobo, result.unallocatedKobo + result.roundingKobo);
      assert.equal(result.beneficiaryKobo, 0);
    } else assert.equal(result.reason, "NO_DISTRIBUTABLE_COMMISSION");
  }
});
