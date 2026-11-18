"use strict";

// Pure server-side planning only. This module never reads/writes wallets,
// starts workers, creates indexes, or treats caller input as payment evidence.
// Production admission must supply verified cost and beneficiary snapshots and
// atomically exclude the legacy manager and retail commission writers.
const ROLES = Object.freeze([
  "BUSINESS_NETWORK_AGENT", "AGGREGATOR", "STATE_MANAGER",
  "ZONAL_MANAGER", "HEAD_OFFICE",
]);
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(`INVALID_${name}`);
  return value;
};
const date = (value, name) => {
  if (!(typeof value === "string" || value instanceof Date)) fail(`INVALID_${name}`);
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) fail(`INVALID_${name}`);
  return result;
};
const text = (value, name) => {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      value.length > 200) fail(`INVALID_${name}`);
  return value;
};

function percentageBasisPoints(percentages) {
  if (!percentages || typeof percentages !== "object" || Array.isArray(percentages) ||
      Object.keys(percentages).length !== ROLES.length ||
      Object.keys(percentages).some(key => !ROLES.includes(key))) fail("INVALID_PERCENTAGE_ROLES");
  const values = {};
  for (const role of ROLES) {
    const value = percentages[role];
    if (!own(percentages, role) || typeof value !== "number" ||
        !Number.isFinite(value) || value < 0 || value > 100 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
      fail("INVALID_PERCENTAGE_PRECISION");
    }
    values[role] = Math.round(value * 100);
  }
  if (Object.values(values).reduce((a, b) => a + b, 0) !== 10000) {
    fail("PERCENTAGES_MUST_TOTAL_100");
  }
  return values;
}

function validateRule(rule, now) {
  if (!rule || typeof rule !== "object") fail("INVALID_RULE");
  text(rule.id, "RULE_ID");
  text(rule.serviceType, "SERVICE_TYPE");
  if (typeof rule.enabled !== "boolean") fail("INVALID_RULE_ENABLED");
  const effectiveAt = date(rule.effectiveAt, "EFFECTIVE_DATE");
  if (effectiveAt < date(now, "CURRENT_DATE")) fail("RULE_MUST_BE_FUTURE_EFFECTIVE");
  percentageBasisPoints(rule.percentages);
  return {
    id: rule.id, serviceType: rule.serviceType,
    enabled: rule.enabled, effectiveAt: new Date(effectiveAt).toISOString(),
    percentages: { ...rule.percentages },
  };
}

// All monetary inputs/outputs are integer kobo. Costs must come from an
// independently verified, immutable server-side source, never a client quote.
function profitPool(costs) {
  if (!costs || costs.verified !== true) fail("VERIFIED_COST_EVIDENCE_REQUIRED");
  text(costs.evidenceReference, "COST_EVIDENCE_REFERENCE");
  const sale = integer(costs.customerAmountKobo, "CUSTOMER_AMOUNT");
  const provider = integer(costs.providerCostKobo, "PROVIDER_COST");
  const direct = integer(costs.directCostsKobo, "DIRECT_COSTS");
  const other = integer(costs.otherApprovedCostsKobo, "OTHER_APPROVED_COSTS");
  if (other > 0) text(costs.otherCostsApprovalReference, "OTHER_COSTS_APPROVAL");
  // BigInt avoids overflow before subtraction.
  const net = BigInt(sale) - BigInt(provider) - BigInt(direct) - BigInt(other);
  return net > 0n ? Number(net) : 0;
}

function allocate(poolKobo, percentages, beneficiaries) {
  integer(poolKobo, "PROFIT_POOL");
  const bps = percentageBasisPoints(percentages);
  if (!beneficiaries || typeof beneficiaries !== "object") fail("INVALID_BENEFICIARIES");
  // Remainders of indivisible kobo are company rounding, not a redistribution
  // to another beneficiary. Each configured share is floored independently.
  const amounts = ROLES.map(role =>
    Number(BigInt(poolKobo) * BigInt(bps[role]) / 10000n));
  const seen = new Set();
  const allocations = ROLES.map((role, index) => {
    const candidate = beneficiaries[role];
    const id = candidate?.id;
    const company = role === "HEAD_OFFICE";
    const eligible = !company && candidate?.eligible === true &&
      typeof id === "string" && /^[a-f\d]{24}$/i.test(id) &&
      !seen.has(id.toLowerCase());
    if (eligible) seen.add(id.toLowerCase());
    return {
      role, beneficiaryId: eligible ? id.toLowerCase() : null,
      basisPoints: bps[role], amountKobo: amounts[index],
      custody: company ? "COMPANY" : eligible ? "BENEFICIARY" : "UNALLOCATED_COMPANY",
    };
  });
  const roundingKobo = poolKobo - amounts.reduce((a, b) => a + b, 0);
  const unallocatedKobo = allocations.filter(a => a.custody === "UNALLOCATED_COMPANY")
    .reduce((sum, row) => sum + row.amountKobo, 0);
  const companyKobo = allocations.find(a => a.role === "HEAD_OFFICE").amountKobo +
    unallocatedKobo + roundingKobo;
  const beneficiaryKobo = allocations.filter(a => a.custody === "BENEFICIARY")
    .reduce((sum, row) => sum + row.amountKobo, 0);
  if (companyKobo + beneficiaryKobo !== poolKobo) fail("PROFIT_POOL_NOT_CONSERVED");
  return { poolKobo, allocations, roundingKobo, unallocatedKobo, companyKobo, beneficiaryKobo };
}

function plan({ transaction, rule, costs, beneficiaries }) {
  text(transaction?.id, "TRANSACTION_ID");
  text(transaction.reference, "TRANSACTION_REFERENCE");
  // A saved success label alone is not proof of settlement or positive profit.
  if (transaction.status !== "SUCCESSFUL" || transaction.settlementVerified !== true ||
      transaction.reversed === true) return { eligible: false, reason: "UNSETTLED_OR_REVERSED" };
  if (!rule || rule.enabled !== true) return { eligible: false, reason: "DISTRIBUTION_PAUSED" };
  text(rule.id, "RULE_ID");
  if (transaction.serviceType !== rule.serviceType) return { eligible: false, reason: "SERVICE_MISMATCH" };
  if (date(transaction.createdAt, "TRANSACTION_DATE") < date(rule.effectiveAt, "EFFECTIVE_DATE")) {
    return { eligible: false, reason: "BEFORE_RULE_EFFECTIVE_DATE" };
  }
  if (costs?.customerAmountKobo !== transaction.amountKobo) fail("COST_TRANSACTION_AMOUNT_MISMATCH");
  const poolKobo = profitPool(costs);
  if (!poolKobo) return { eligible: false, reason: "NO_POSITIVE_NET_PROFIT" };
  return {
    eligible: true, transactionId: transaction.id, reference: transaction.reference,
    ruleId: rule.id, eventKey: `profit-sharing:${transaction.id}`,
    costEvidenceReference: costs.evidenceReference,
    ...allocate(poolKobo, rule.percentages, beneficiaries),
  };
}

module.exports = { ROLES, percentageBasisPoints, validateRule, profitPool, allocate, plan };
