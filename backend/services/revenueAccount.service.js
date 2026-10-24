const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Commission = require("../models/commission.model");
const Audit = require("../models/adminAuditLog.model");
const rules = require("./revenueAccountingRules");
const ACTIONS = ["REVENUE_RECOGNIZED", "REVENUE_REVERSED", "REVENUE_ADJUSTED"];
const MAX_ROWS = 10000;
const projection = {
  reference: 1, customerId: 1, serviceType: 1, provider: 1, amount: 1, status: 1,
  createdAt: 1, agentCommission: 1, stateManagerCommission: 1, zonalManagerCommission: 1,
  reversalReference: 1, reversalTransactionId: 1, reversedTransactionId: 1,
  providerRequestId: 1, providerEvidenceCorrelated: 1, providerEvidenceOutcome: 1,
  "providerResponse.financialAccounting": 1, "providerResponse.providerPrice": 1,
  "providerResponse.telecomAbodeSettlement": 1, "providerResponse.airtimeLifecycle.reasonCode": 1,
  "providerResponse.electricityLifecycle.reasonCode": 1,
  "providerResponse.response.requestId": 1, "providerResponse.response.request_id": 1,
  "providerResponse.response.request-id": 1, "providerResponse.response.status": 1, "providerResponse.response.Status": 1,
};
const fail = (message, code = 400) => Object.assign(new Error(message), { statusCode: code });
function filters(query = {}) {
  const result = { service: String(query.service || ""), status: String(query.status || ""),
    q: String(query.q || "").trim(), from: query.from || "", to: query.to || "" };
  if (result.service && !rules.SERVICES.includes(result.service)) throw fail("Invalid revenue service.");
  if (result.status && !["INITIATED","PROCESSING","SUCCESS","SUCCESSFUL","PENDING","FAILED","REFUNDED","REVERSED","REVERSAL_PENDING","UNDER_REVIEW"].includes(result.status)) throw fail("Invalid status.");
  if (result.q.length > 120) throw fail("Search is limited to 120 characters.");
  for (const k of ["from", "to"]) if (result[k]) {
    const date = new Date(String(result[k]) + "T00:00:00Z");
    if (typeof result[k] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result[k]) ||
        Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== result[k]) throw fail("Invalid date.");
  }
  if (result.from && result.to && result.from > result.to) throw fail("Start date must precede end date.");
  return result;
}
function sourceFilter(f) {
  const match = { serviceType: f.service || { $in: rules.SERVICES } };
  if (f.status) match.status = f.status;
  if (f.from || f.to) {
    match.createdAt = {};
    if (f.from) match.createdAt.$gte = new Date(f.from + "T00:00:00+01:00");
    if (f.to) match.createdAt.$lt = new Date(new Date(f.to + "T00:00:00+01:00").getTime() + 86400000);
  }
  return match;
}
async function project(sources, withNames = true) {
  const ids = sources.map(t => t._id);
  const customerIds = [...new Set(sources.map(t => String(t.customerId)))];
  const [commissions, customers] = await Promise.all([
    Commission.find({ transactionId: { $in: ids }, beneficiaryRole: { $ne: "HEAD_OFFICE" },
      status: { $nin: ["FAILED", "REVERSED", "CANCELLED"] } }).select("transactionId commissionAmount").lean(),
    withNames ? User.find({ _id: { $in: customerIds } }).select("fullName").lean() : [],
  ]);
  const commissionMap = new Map();
  for (const c of commissions) commissionMap.set(String(c.transactionId),
    (commissionMap.get(String(c.transactionId)) || 0) + (rules.positive(c.commissionAmount) || 0));
  const names = new Map(customers.map(c => [String(c._id), c.fullName || "Customer"]));
  return sources.map(t => rules.projectTransaction(t, commissionMap.get(String(t._id)) ?? null,
    names.get(String(t.customerId)) || "Customer"));
}
async function rows(query) {
  const f = filters(query);
  const sources = await Transaction.find(sourceFilter(f), projection).sort({ createdAt: -1, _id: -1 }).limit(MAX_ROWS + 1).lean();
  if (sources.length > MAX_ROWS) throw fail("Report exceeds 10,000 transactions. Choose a narrower date range.", 422);
  const items = await project(sources);
  return items.filter(r => !f.q || [r.reference, r.transactionId, r.customerName].some(s => s.toLowerCase().includes(f.q.toLowerCase())));
}
const publicRow = row => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_") && k !== "customerId"));
const page = (items, query) => {
  const number = Number(query.page || 1), limit = Number(query.limit || 25);
  if (!Number.isInteger(number) || number < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  return { items: items.slice((number - 1) * limit, number * limit), page: number, limit,
    total: items.length, pages: Math.ceil(items.length / limit) };
};
const nigeriaDate = date => new Date(new Date(date).getTime() + 3600000).toISOString().slice(0, 10);
let syncStatus = { lastRunAt: null, status: "NOT_STARTED" };
function ledgerPipeline() {
  return [
    { $match: { action: { $in: ACTIONS } } },
    { $sort: { "metadata.revenueTransactionId": 1, "metadata.revenueSequence": -1 } },
    { $group: { _id: "$metadata.revenueTransactionId",
      state: { $first: "$metadata.accounting.state" },
      grossRevenue: { $sum: "$metadata.accounting.delta.customerPayment" },
      netProfit: { $sum: "$metadata.accounting.delta.netProfit" }, entries: { $sum: 1 } } },
    { $group: { _id: null, grossRevenue: { $sum: "$grossRevenue" },
      netProfit: { $sum: "$netProfit" }, entries: { $sum: "$entries" },
      active: { $sum: { $cond: [{ $gt: ["$state.customerPayment", 0] }, 1, 0] } },
      costed: { $sum: { $cond: [{ $and: [{ $gt: ["$state.customerPayment", 0] },
        { $ne: ["$state.providerCost", null] }] }, 1, 0] } } } },
  ];
}
async function summary(query) {
  const selected = await rows(query);
  const today = nigeriaDate(new Date());
  const midnight = new Date(today + "T00:00:00+01:00");
  const yesterday = nigeriaDate(new Date(midnight.getTime() - 86400000));
  const day = new Date(today + "T12:00:00Z").getUTCDay();
  const week = nigeriaDate(new Date(midnight.getTime() - ((day + 6) % 7) * 86400000));
  const periodRows = query.from || query.to ? await rows({ ...query, from: "", to: "" }) : selected;
  const revenue = rs => rules.totals(rs).grossRevenue;
  const dates = [...new Set(selected.map(r => nigeriaDate(r.date)))].sort();
  // Month buckets keep long-range charts bounded without dropping history.
  const monthly = dates.length > 90;
  const buckets = [...new Set(dates.map(d => monthly ? d.slice(0,7) : d))];
  const trend = buckets.map(date => ({ date, ...rules.totals(selected.filter(r => nigeriaDate(r.date).startsWith(date))) }));
  const [posted = { grossRevenue: 0, netProfit: 0, entries: 0, active: 0, costed: 0 }] = await Audit.aggregate(ledgerPipeline());
  return { totals: rules.totals(selected), periods: {
    today: revenue(periodRows.filter(r => nigeriaDate(r.date) === today)),
    yesterday: revenue(periodRows.filter(r => nigeriaDate(r.date) === yesterday)),
    week: revenue(periodRows.filter(r => nigeriaDate(r.date) >= week)),
    month: revenue(periodRows.filter(r => nigeriaDate(r.date).slice(0,7) === today.slice(0,7))) },
    services: rules.SERVICES.map(serviceType => ({ serviceType, ...rules.totals(selected.filter(r => r.serviceType === serviceType)) })),
    trend: trend.map(r => ({ date: r.date, grossRevenue: r.grossRevenue, providerCosts: r.providerCosts, netProfit: r.netProfit })),
    ledger: { grossRevenue: rules.major(posted.grossRevenue), netProfit: !posted.active || posted.costed ? rules.major(posted.netProfit) : null, entries: posted.entries,
      uncostedTransactions: posted.active - posted.costed,
      readOnly: true, scope: "ALL_TIME_POSTED", asOf: syncStatus.lastRunAt },
    reconciliation: syncStatus };
}
let indexes;
function ensureIndexes() {
  if (!indexes) indexes = Promise.all([
    Audit.collection.createIndex({ "metadata.revenuePreviousKey": 1 }, { unique: true, sparse: true, name: "uniq_revenue_previous_entry" }),
    Audit.collection.createIndex({ "metadata.revenueTransactionId": 1, "metadata.revenueSequence": -1 }, { name: "revenue_transaction_sequence" }),
  ]).catch(e => { indexes = null; throw e; });
  return indexes;
}
async function append(row, actor = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await Audit.findOne({ "metadata.revenueTransactionId": row.transactionId })
      .sort({ "metadata.revenueSequence": -1 }).lean();
    const change = rules.transition(previous?.metadata?.accounting, row);
    if (!change) return "UNCHANGED";
    try {
      // The bookkeeper is SYSTEM, including admin-triggered scans. Recording the
      // initiator separately prevents a later scoped/SVP self-audit from exposing
      // global financial rows merely because that person once requested a scan.
      await Audit.create({ actorId: null, actorRole: "SYSTEM",
        actorName: "Revenue accounting", action: change.eventType,
        reason: change.eventType === "REVENUE_REVERSED" ? "Source transaction no longer represents earned revenue."
          : "Recorded provider evidence, costs and commissions reconciled. No wallet movement.",
        metadata: { revenueLedger: true, revenueInitiatorId: actor?._id ? String(actor._id) : null,
          revenueTransactionId: row.transactionId,
          revenuePreviousKey: row.transactionId + ":" + (previous ? String(previous._id) : "ROOT"),
          revenueSequence: (previous?.metadata?.revenueSequence || 0) + 1,
          accounting: { ...change, linkedEntryId: previous ? String(previous._id) : null,
            transactionId: row.transactionId, reference: row.reference, serviceType: row.serviceType,
            transactionDate: row.date, sourceStatus: row.status, costSource: row.costSource,
            policy: "recorded-cost-and-correlated-outcome-v1" } } });
      return change.eventType;
    } catch (e) { if (e.code !== 11000) throw e; }
  }
  throw fail("Concurrent accounting changed. Reconcile again.", 409);
}
let cursor = null;
let inFlight;
async function reconcile(actor = null) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await ensureIndexes();
    const match = { serviceType: { $in: rules.SERVICES }, ...(cursor ? { _id: { $gt: cursor } } : {}) };
    const sources = await Transaction.find(match, projection).sort({ _id: 1 }).limit(100).lean();
    // Fresh confirmations/refunds must not wait for the fair archive scan.
    const recent = await Transaction.find({ serviceType: { $in: rules.SERVICES },
      status: { $in: ["SUCCESS", "SUCCESSFUL", "REFUNDED", "REVERSED"] } }, projection)
      .sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
    const unique = [...new Map([...sources, ...recent].map(row => [String(row._id), row])).values()];
    const result = { processed: 0, recognized: 0, reversed: 0, adjusted: 0, hasMore: sources.length === 100 };
    for (const row of await project(unique, false)) {
      const event = await append(row, actor); result.processed++;
      if (event === "REVENUE_RECOGNIZED") result.recognized++;
      if (event === "REVENUE_REVERSED") result.reversed++;
      if (event === "REVENUE_ADJUSTED") result.adjusted++;
    }
    cursor = sources.length === 100 ? sources[sources.length - 1]._id : null;
    syncStatus = { lastRunAt: new Date().toISOString(), status: result.hasMore ? "SCANNING" : "CURRENT", ...result };
    return result;
  })().catch(e => { syncStatus = { ...syncStatus, status: "ERROR", error: "Accounting sync unavailable. No source transaction changed." }; throw e; })
    .finally(() => { inFlight = null; });
  return inFlight;
}
function startWorker() {
  const run = () => reconcile().catch(e => console.error("[REVENUE] Bookkeeping sync unavailable:", e.code || e.name));
  const first = setTimeout(run, 15000); first.unref();
  const timer = setInterval(run, 30000); timer.unref();
}
async function ledger(query) {
  const f = filters(query);
  const match = { action: { $in: ACTIONS } };
  if (f.service) match["metadata.accounting.serviceType"] = f.service;
  if (f.from || f.to) {
    match.createdAt = {};
    if (f.from) match.createdAt.$gte = new Date(f.from + "T00:00:00+01:00");
    if (f.to) match.createdAt.$lt = new Date(new Date(f.to + "T00:00:00+01:00").getTime() + 86400000);
  }
  const docs = await Audit.find(match).sort({ createdAt: -1, _id: -1 }).limit(10001).lean();
  if (docs.length > MAX_ROWS) throw fail("Narrow the ledger date range.", 422);
  const items = docs.map(doc => {
    const a = doc.metadata.accounting;
    return { id: String(doc._id), transactionId: a.transactionId, eventType: doc.action,
      linkedEntryId: a.linkedEntryId, date: doc.createdAt, costSource: a.costSource, reason: doc.reason,
      ...Object.fromEntries(rules.FIELDS.map(k => [k, a.state.providerCost === null &&
        ["providerCost", "grossProfit", "netProfit"].includes(k) && !a.delta[k] ? null : rules.major(a.delta[k])])) };
  }).filter(r => !f.q || r.transactionId.includes(f.q));
  return page(items, query);
}
module.exports = { filters, sourceFilter, rows, publicRow, page, summary, ledger, ledgerPipeline, reconcile, startWorker, append, ensureIndexes, project, nigeriaDate };
