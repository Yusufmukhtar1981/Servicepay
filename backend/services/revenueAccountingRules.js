// Reporting-only rules. Never import wallets, provider transports or price catalogues.
const crypto = require("node:crypto");
const SERVICES = ["DATA", "AIRTIME", "ELECTRICITY", "CABLE"];
const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL"]);
const money = value => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const minor = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};
const major = value => value === null ? null : value / 100;
const positive = value => { const n = money(value); return n !== null && n >= 0 ? n : null; };
const text = value => String(value ?? "").trim();
function providerConfirmed(t) {
  if (!SUCCESS.has(t.status)) return false;
  const p = t.providerResponse || {};
  if (t.providerEvidenceCorrelated === true && t.providerEvidenceOutcome === "SUCCESS") return true;
  if (p.telecomAbodeSettlement?.outcome === "SUCCESS" && p.telecomAbodeSettlement.requestIdMatches === true) return true;
  for (const lifecycle of [p.airtimeLifecycle, p.electricityLifecycle]) {
    if (["CORRELATED_PROVIDER_SUCCESS", "CORRELATED_SUCCESS"].includes(lifecycle?.reasonCode)) return true;
  }
  const response = p.response || {};
  const echoed = text(response.requestId || response.request_id || response["request-id"]);
  return Boolean(t.providerRequestId && echoed === text(t.providerRequestId) &&
    ["success", "successful", "completed", "delivered"].includes(text(response.status || response.Status).toLowerCase()));
}
function costSnapshot(t) {
  const p = t.providerResponse || {};
  const invoice = p.financialAccounting || {};
  const cost = positive(invoice.providerCost);
  if (cost !== null && !["AWAITING_FULFILLMENT", "PROVIDER_COST_UNCONFIRMED", "AWAITING_PROVIDER_COST"].includes(invoice.status)) {
    return { cost, source: "RECORDED_PROVIDER_INVOICE" };
  }
  // This is the immutable, admitted DATA plan's provider cost, not today's catalogue.
  const dataPrice = positive(p.providerPrice);
  if (t.serviceType === "DATA" && t.provider === "TELECOM_ABODE" && dataPrice !== null && dataPrice > 0) {
    return { cost: dataPrice, source: "TRANSACTION_PROVIDER_PRICE_SNAPSHOT" };
  }
  return { cost: null, source: "UNCONFIRMED" };
}
function projectTransaction(t, recordedCommission = null, customerName = "") {
  const confirmed = providerConfirmed(t) && !t.reversalReference && !t.reversalTransactionId && !t.reversedTransactionId;
  const snapshot = costSnapshot(t);
  const payment = positive(t.amount);
  if (payment === null) throw new Error("Invalid recorded transaction amount");
  const a = t.providerResponse?.financialAccounting || {};
  const sum = keys => keys.reduce((n, k) => n + (positive(a[k]) || 0), 0);
  // serviceFee is a CUSTOMER charge already included in amount, not an expense.
  const fees = sum(["providerFee", "processingFee"]);
  const other = sum(["otherDirectCosts"]);
  const transactionCommission = ["agentCommission", "stateManagerCommission", "zonalManagerCommission"]
    .reduce((n, k) => n + (positive(t[k]) || 0), 0);
  const commissions = recordedCommission === null ? transactionCommission : recordedCommission;
  const gross = confirmed && snapshot.cost !== null ? payment - snapshot.cost : null;
  const net = gross === null ? null : gross - fees - commissions - other;
  const status = !SUCCESS.has(t.status) ? "NOT_EARNED" : !confirmed ? "PROVIDER_EVIDENCE_REQUIRED"
    : snapshot.cost === null ? "PROVIDER_COST_UNCONFIRMED" : "VERIFIED";
  const state = {
    customerPayment: confirmed ? payment : 0,
    providerCost: confirmed ? snapshot.cost : 0,
    grossProfit: confirmed ? gross : 0,
    fees: confirmed ? fees : 0, commissions: confirmed ? commissions : 0,
    otherDirectCosts: confirmed ? other : 0, netProfit: confirmed ? net : 0,
    costSource: confirmed ? snapshot.source : "NOT_EARNED",
  };
  const stateHash = crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
  return {
    transactionId: String(t._id), reference: text(t.reference), customerId: String(t.customerId),
    customerName, serviceType: t.serviceType, provider: text(t.provider),
    customerPayment: major(payment), providerCost: confirmed ? major(snapshot.cost) : null,
    grossProfit: major(gross), fees: major(fees), commissions: major(commissions),
    otherDirectCosts: major(other), netProfit: major(net),
    date: new Date(t.createdAt).toISOString(), status: t.status,
    accountingStatus: status, costSource: snapshot.source, confirmed,
    _state: state, _stateHash: stateHash,
  };
}
const FIELDS = ["customerPayment", "providerCost", "grossProfit", "fees", "commissions", "otherDirectCosts", "netProfit"];
function transition(previous, row) {
  if (previous?.stateHash === row._stateHash) return null;
  if (!previous && !row.confirmed) return null;
  const old = previous?.state || {};
  const delta = Object.fromEntries(FIELDS.map(k => [k, (row._state[k] ?? 0) - (old[k] ?? 0)]));
  return { eventType: !previous ? "REVENUE_RECOGNIZED" : !row.confirmed ? "REVENUE_REVERSED" : "REVENUE_ADJUSTED",
    state: row._state, stateHash: row._stateHash, delta };
}
function totals(rows) {
  const earned = rows.filter(r => r.confirmed);
  const costed = earned.filter(r => r.providerCost !== null);
  const sum = (rs, k) => major(rs.reduce((n, r) => n + (money(r[k]) || 0), 0));
  return { grossRevenue: sum(earned, "customerPayment"), providerCosts: sum(costed, "providerCost"),
    grossProfit: costed.length ? sum(costed, "grossProfit") : earned.length ? null : 0,
    fees: sum(earned, "fees"), commissions: sum(earned, "commissions"), otherDirectCosts: sum(earned, "otherDirectCosts"),
    netProfit: costed.length ? sum(costed, "netProfit") : earned.length ? null : 0,
    successfulTransactions: earned.length, costedTransactions: costed.length,
    uncostedTransactions: earned.length - costed.length,
    unverifiedTransactions: rows.filter(r => SUCCESS.has(r.status) && !r.confirmed).length,
    excludedTransactions: rows.length - earned.length,
    accountingComplete: earned.length === costed.length && !rows.some(r => r.accountingStatus === "PROVIDER_EVIDENCE_REQUIRED") };
}
module.exports = { SERVICES, SUCCESS, money, major, positive, providerConfirmed, costSnapshot, projectTransaction, transition, totals, FIELDS };
