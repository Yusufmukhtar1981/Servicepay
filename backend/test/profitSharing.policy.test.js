"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../services/profitSharing.policy");
// Example administrator-entered values, not production defaults.
const percentages = {
  BUSINESS_NETWORK_AGENT: 40, AGGREGATOR: 20, STATE_MANAGER: 15,
  ZONAL_MANAGER: 10, HEAD_OFFICE: 15,
};
const ids = [1, 2, 3, 4].map(n => n.toString(16).padStart(24, "0"));
const beneficiaries = Object.fromEntries(P.ROLES.slice(0, 4).map((role, i) =>
  [role, { id: ids[i], eligible: true }]));
const fixture = () => ({
  transaction: { id: "transaction-1", reference: "original-request-1",
    status: "SUCCESSFUL", settlementVerified: true, reversed: false,
    serviceType: "DATA", amountKobo: 100000, createdAt: "2026-12-02T00:00:00Z" },
  rule: { id: "immutable-rule-1", serviceType: "DATA", enabled: true,
    effectiveAt: "2026-12-01T00:00:00Z", percentages: { ...percentages } },
  costs: { verified: true, evidenceReference: "verified-provider-invoice-1",
    customerAmountKobo: 100000, providerCostKobo: 80000,
    directCostsKobo: 1000, otherApprovedCostsKobo: 1000,
    otherCostsApprovalReference: "approved-cost-1" },
  beneficiaries: structuredClone(beneficiaries),
});

test("initial split uses Business Network Agent and totals exactly 100%", () => {
  assert.equal(percentages.BUSINESS_NETWORK_AGENT, 40);
  assert.equal(percentages.AGGREGATOR, 20);
  assert.equal(Object.values(P.percentageBasisPoints(percentages)).reduce((a, b) => a + b), 10000);
  assert.equal(P.ROLES.includes("BRM"), false);
  assert.equal(P.ROLES.includes("CM"), false);
});
test("rejects incorrect totals, fabricated roles, strings and excessive precision", () => {
  for (const value of [
    { ...percentages, HEAD_OFFICE: 14.99 },
    { ...percentages, CM: 0 },
    { ...percentages, AGGREGATOR: "20" },
    { ...percentages, AGGREGATOR: -20 },
    { ...percentages, AGGREGATOR: 20.001 },
    { ...percentages, AGGREGATOR: NaN },
    { ...percentages, AGGREGATOR: Infinity },
  ]) assert.throws(() => P.percentageBasisPoints(value));
});
test("allows configurable percentage precision up to two decimal places", () => {
  const value = { ...percentages, AGGREGATOR: 19.99, HEAD_OFFICE: 15.01 };
  assert.equal(P.percentageBasisPoints(value).AGGREGATOR, 1999);
});
test("only net profit after all costs is distributed, never gross sales", () => {
  const value = P.plan(fixture());
  assert.equal(value.poolKobo, 18000);
  assert.deepEqual(value.allocations.map(row => row.amountKobo), [7200, 3600, 2700, 1800, 2700]);
  assert.equal(value.companyKobo + value.beneficiaryKobo, 18000);
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
test("missing/ineligible hierarchy shares remain company unallocated", () => {
  const input = fixture();
  delete input.beneficiaries.AGGREGATOR;
  input.beneficiaries.STATE_MANAGER.eligible = false;
  const result = P.plan(input);
  assert.equal(result.unallocatedKobo, 6300);
  assert.equal(result.allocations[0].amountKobo, 7200);
  assert.equal(result.companyKobo, 9000);
  assert.equal(result.beneficiaryKobo, 9000);
});
test("duplicate hierarchy identities receive one share, never stacked shares", () => {
  const input = fixture(); input.beneficiaries.AGGREGATOR.id = ids[0];
  const result = P.plan(input);
  assert.equal(result.unallocatedKobo, 3600);
  assert.equal(result.allocations[1].beneficiaryId, null);
});
test("invalid beneficiary identity is retained by company", () => {
  const input = fixture(); input.beneficiaries.BUSINESS_NETWORK_AGENT.id = "fake-user";
  assert.equal(P.plan(input).unallocatedKobo, 7200);
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
  input.rule.percentages.HEAD_OFFICE = 90;
  assert.equal(result.percentages.HEAD_OFFICE, 15);
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
    assert.equal(result.companyKobo + result.beneficiaryKobo, pool);
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
