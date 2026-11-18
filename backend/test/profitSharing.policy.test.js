"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../services/profitSharing.policy");
// Example administrator-entered values, not production defaults.
const percentages = {
  HEAD_OFFICE: 38, ZONAL_MANAGER: 27, STATE_MANAGER: 21, AGGREGATOR: 14,
};
const ids = [1, 2, 3, 4].map(n => n.toString(16).padStart(24, "0"));
const beneficiaries = { HEAD_OFFICE: { kind: "COMPANY", eligible: true },
  ZONAL_MANAGER: { id: ids[0], eligible: true }, STATE_MANAGER: { id: ids[1], eligible: true },
  AGGREGATOR: { id: ids[2], eligible: true } };
const fixture = () => ({
  transaction: { id: "transaction-1", reference: "original-request-1",
    status: "SUCCESSFUL", settlementVerified: true, reversed: false,
    serviceType: "DATA", amountKobo: 100000, createdAt: "2026-12-02T00:00:00Z" },
  rule: { id: "immutable-rule-1", serviceType: "DATA", enabled: true,
    effectiveAt: "2026-12-01T00:00:00Z", percentages: { ...percentages },
    policyVersion: 3 },
  costs: { verified: true, evidenceReference: "verified-provider-invoice-1",
    customerAmountKobo: 100000, revenueKobo: 100000, providerCostKobo: 80000,
    directCostsKobo: 1000, otherApprovedCostsKobo: 1000,
    otherCostsApprovalReference: "approved-cost-1" },
  beneficiaries: structuredClone(beneficiaries),
});

test("only four administrator-configured beneficiaries exist and no template is exported", () => {
  assert.deepEqual(P.ROLES, ["HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER", "AGGREGATOR"]);
  assert.equal(P.ALLOCATION_SUGGESTION, undefined);
  assert.equal(Object.values(P.percentageBasisPoints(percentages)).reduce((a, b) => a + b), 10000);
  assert.equal(P.ROLES.includes("BRM"), false);
  assert.equal(P.ROLES.includes("CM"), false);
});
test("rejects incorrect totals, fabricated roles, strings and excessive precision", () => {
  for (const value of [
    { ...percentages, ZONAL_MANAGER: 26.99 },
    { ...percentages, BUSINESS_NETWORK_AGENT: 0 },
    { ...percentages, CM: 0 },
    { ...percentages, AGGREGATOR: "20" },
    { ...percentages, AGGREGATOR: -20 },
    { ...percentages, AGGREGATOR: 20.001 },
    { ...percentages, AGGREGATOR: NaN },
    { ...percentages, AGGREGATOR: Infinity },
  ]) assert.throws(() => P.percentageBasisPoints(value));
});
test("allows configurable percentage precision up to two decimal places", () => {
  const value = { ...percentages, HEAD_OFFICE: 37.99, ZONAL_MANAGER: 27.01 };
  assert.equal(P.percentageBasisPoints(value).HEAD_OFFICE, 3799);
});
test("only verified positive company net profit is shared using exactly the entered rates", () => {
  const value = P.plan(fixture());
  assert.equal(value.netProfitKobo, 18000);
  assert.equal(value.poolKobo, 18000);
  assert.equal(value.headOfficeKobo, 6840);
  assert.deepEqual(value.allocations.map(row => row.amountKobo), [6840, 4860, 3780, 2520]);
  assert.equal(value.headOfficeKobo + value.beneficiaryKobo, 18000);
  assert.equal(value.allocations[0].beneficiaryId, null);
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
test("missing/ineligible hierarchy shares remain unallocated, never additional Head Office profit", () => {
  const input = fixture();
  delete input.beneficiaries.AGGREGATOR;
  input.beneficiaries.STATE_MANAGER.eligible = false;
  const result = P.plan(input);
  assert.equal(result.unallocatedKobo, 6300);
  assert.equal(result.allocations[0].amountKobo, 6840);
  assert.equal(result.headOfficeKobo, 6840);
  assert.equal(result.beneficiaryKobo, 4860);
});
test("duplicate hierarchy identities receive one share, never stacked shares", () => {
  const input = fixture(); input.beneficiaries.STATE_MANAGER.id = ids[0];
  const result = P.plan(input);
  assert.equal(result.unallocatedKobo, 3780);
  assert.equal(result.allocations[2].beneficiaryId, null);
});
test("invalid beneficiary identity remains unallocated", () => {
  const input = fixture(); input.beneficiaries.AGGREGATOR.id = "fake-user";
  assert.equal(P.plan(input).unallocatedKobo, 2520);
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
  assert.equal(result.percentages.AGGREGATOR, 14);
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
    assert.equal(result.headOfficeKobo + result.unallocatedKobo + result.roundingKobo + result.beneficiaryKobo, pool);
    assert.ok(result.roundingKobo >= 0 && result.roundingKobo < P.ROLES.length);
    assert.equal(result.allocations.reduce((a, row) => a + row.amountKobo, 0) + result.roundingKobo, pool);
  }
});
test("no missing cost component silently defaults to zero", () => {
  for (const key of ["customerAmountKobo", "revenueKobo", "providerCostKobo", "directCostsKobo", "otherApprovedCostsKobo"]) {
    const costs = fixture().costs; delete costs[key];
    assert.throws(() => P.profitPool(costs));
  }
});
test("every allocation is explicit and no legacy policy or separate pool can supply defaults", () => {
  for (const value of [undefined, null, "38", -1, 100.01, 1.001, NaN, Infinity]) {
    const input = fixture(); input.rule.percentages.HEAD_OFFICE = value;
    assert.throws(() => P.plan(input));
  }
  const old = fixture(); delete old.rule.policyVersion;
  const before = structuredClone(old);
  assert.throws(() => P.plan(old), { code: "FOUR_BENEFICIARY_POLICY_V3_REQUIRED" });
  assert.deepEqual(old, before);
  const pool = fixture(); pool.rule.poolPercentage = 50;
  assert.throws(() => P.plan(pool), { code: "LEGACY_POOL_CONFIGURATION_NOT_SUPPORTED" });
});
test("arbitrary explicit allocations conserve net profit including rounding and absent hierarchy", () => {
  for (const rates of [percentages,
    { HEAD_OFFICE: 17.25, ZONAL_MANAGER: 22.75, STATE_MANAGER: 10, AGGREGATOR: 50 },
    { HEAD_OFFICE: 0, ZONAL_MANAGER: 0, STATE_MANAGER: 0, AGGREGATOR: 100 }]) {
    const input = fixture(); input.rule.percentages = rates;
    input.costs.providerCostKobo = 80001; input.beneficiaries = {};
    const result = P.plan(input);
    assert.equal(result.netProfitKobo, result.poolKobo);
    assert.equal(result.poolKobo, result.unallocatedKobo + result.roundingKobo);
    assert.equal(result.headOfficeKobo, 0); assert.equal(result.beneficiaryKobo, 0);
  }
});
test("customer principal is never recognized as revenue by default", () => {
  const input = fixture();
  Object.assign(input.costs, { revenueKobo: 10000, providerCostKobo: 0,
    directCostsKobo: 100, otherApprovedCostsKobo: 0 });
  assert.equal(input.transaction.amountKobo, 100000);
  assert.equal(P.plan(input).poolKobo, 9900);
  delete input.costs.revenueKobo;
  assert.throws(() => P.plan(input), { code: "INVALID_VERIFIED_REVENUE" });
});
test("Head Office shares cannot credit an arbitrary administrator personal identity", () => {
  const input = fixture(); input.beneficiaries.HEAD_OFFICE = { id: ids[3], eligible: true };
  const result = P.plan(input);
  assert.equal(result.headOfficeKobo, 0); assert.equal(result.unallocatedKobo, 6840);
});
