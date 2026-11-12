"use strict";
// Reporting only: no payment clients, wallet writers, migrations or workers.
const mongoose = require("mongoose");
const I = require("./customerIntelligence.service");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Settings = require("../models/appSettings.model");
const Audit = require("../models/adminAuditLog.model");
const DAY = 86400000, OFFSET = 3600000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const permissions = req => new Set(req.staffAccess?.permissions || []);
const has = (req, p) => permissions(req).has(p) || permissions(req).has("*");
const capabilities = req => ({
  finance: String(req.user?.role || "").toUpperCase() === "HEAD_OFFICE" &&
    req.staffAccess?.isHeadOffice === true && has(req, "finance.view"),
  export: has(req, "executive.control_center.export"),
});
function period(q = {}, now = new Date()) {
  const d = new Date(+now + OFFSET), y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const local = (year, month, date) => new Date(Date.UTC(year, month, date) - OFFSET);
  const today = local(y, m, day), key = q.range || "today";
  let start, end = now;
  switch (key) {
    case "today": start = today; break;
    case "yesterday": start = new Date(+today - DAY); end = today; break;
    case "7d": start = new Date(+today - 6 * DAY); break;
    case "30d": start = new Date(+today - 29 * DAY); break;
    case "thisMonth": start = local(y, m, 1); break;
    case "lastMonth": start = local(y, m - 1, 1); end = local(y, m, 1); break;
    case "thisYear": start = local(y, 0, 1); break;
    case "custom": start = I.date(q.from); end = I.date(q.to, true); break;
    default: throw fail("Unsupported executive date range.");
  }
  if (!start || !end || start >= end || end - start > 366 * DAY) throw fail("Choose a valid range of at most 366 days.");
  if (end > now) end = now;
  if (start >= end) throw fail("The reporting period must begin in the past.");
  const date = v => new Date(+v + OFFSET).toISOString().slice(0, 10);
  return { start, end, query: { range: "custom", from: date(start), to: date(new Date(+end - 1)) },
    public: { from: date(start), to: date(new Date(+end - 1)), range: key, timezone: "Africa/Lagos" } };
}
const count = condition => ({ $sum: { $cond: [condition, 1, 0] } });
const stats = () => ({ total: { $sum: 1 }, successful: count({ $eq: ["$_bucket", "SUCCESSFUL"] }),
  pending: count({ $eq: ["$_bucket", "PENDING"] }), failed: count({ $eq: ["$_bucket", "FAILED"] }),
  refunded: count({ $eq: ["$_bucket", "REFUNDED"] }), other: count({ $eq: ["$_bucket", "OTHER"] }),
  successfulVolume: { $sum: { $cond: [{ $eq: ["$_bucket", "SUCCESSFUL"] }, "$amount", 0] } } });
const zero = () => ({ total: 0, successful: 0, pending: 0, failed: 0, refunded: 0, other: 0, successfulVolume: 0 });
function filters(q) {
  const f = {};
  for (const key of ["serviceType", "provider"]) if (q[key]) {
    if (typeof q[key] !== "string" || !/^[A-Za-z0-9 _.:/-]{1,100}$/.test(q[key])) throw fail(`Invalid ${key} filter.`);
    f[key] = q[key];
  }
  if (q.status) {
    if (!["SUCCESSFUL", "PENDING", "FAILED", "REFUNDED", "OTHER"].includes(q.status)) throw fail("Unsupported transaction status.");
    f._bucket = q.status;
  }
  return f;
}
function canonical(req, q, now) {
  // Reuse the verified deduplication and refund-chain predicate, not a second
  // competing definition of success. Fail closed if its adapter shape changes.
  const stages = I.pipeline(req, q, I.DEFAULTS, now).stages.find(s => s.$unionWith)?.$unionWith.pipeline;
  const end = stages?.findIndex(s => s.$set?._day);
  if (!(end > 0)) throw fail("Canonical reporting adapter is unavailable.", 503);
  return stages.slice(0, end);
}
async function transactions(req, q = {}, now = new Date()) {
  const p = period(q, now), pg = I.page(q), selected = filters(q);
  const match = { createdAt: { $gte: p.start, $lt: p.end }, ...selected };
  const stages = canonical(req, p.query, now);
  stages.push({ $match: match }, { $facet: {
    summary: [{ $group: { _id: null, ...stats() } }],
    items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: pg.skip }, { $limit: pg.limit },
      { $project: { _id: 0, id: { $toString: "$_id" }, date: "$createdAt", service: "$serviceType",
        provider: { $ifNull: ["$provider", "UNRECORDED"] }, status: "$_bucket", amount: 1 } }],
    services: [{ $group: { _id: "$serviceType", ...stats() } }, { $sort: { total: -1, _id: 1 } },
      { $project: { _id: 0, service: "$_id", ...Object.fromEntries(Object.keys(zero()).map(k => [k, 1])) } }],
    providers: [{ $group: { _id: { $ifNull: ["$provider", "UNRECORDED"] }, total: { $sum: 1 } } },
      { $sort: { total: -1, _id: 1 } }, { $project: { _id: 0, provider: "$_id", total: 1 } }],
    trend: [{ $group: { _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone: "Africa/Lagos" } }, ...stats() } },
      { $sort: { _id: 1 } }, { $project: { _id: 0, date: "$_id", ...Object.fromEntries(Object.keys(zero()).map(k => [k, 1])) } }],
  } });
  const [result = {}] = await Transaction.aggregate(stages).option({ maxTimeMS: 20000, allowDiskUse: false });
  const summary = { ...zero(), ...result.summary?.[0] }; delete summary._id;
  return { ...result, summary, pagination: { page: pg.page, limit: pg.limit, total: summary.total,
    totalPages: Math.max(1, Math.ceil(summary.total / pg.limit)) } };
}
async function overview(req, q = {}) {
  const now = new Date(), p = period(q, now);
  const cfg = I.settings((await Settings.findOne({ key: "GLOBAL_SETTINGS" }).select("customerIntelligence").lean().maxTimeMS(5000))?.customerIntelligence);
  const built = I.pipeline(req, p.query, cfg, now), facets = I.facets({ limit: 1 }, cfg, built.range);
  delete facets.$facet.items; delete facets.$facet.total; delete facets.$facet.trend;
  for (const key of ["topCount", "topVolume"]) facets.$facet[key] = facets.$facet[key].map(s => s.$limit ? { $limit: 10 } : s);
  // Sequential queries avoid competing full-ledger scans on the small Atlas tier.
  const [customer = {}] = await User.aggregate([...built.stages, facets]).option({ maxTimeMS: 20000, allowDiskUse: false });
  const tx = await transactions(req, q, now);
  const summary = { customers: 0, active: 0, newRegistrations: 0, inactive: 0, never: 0, previousActive: 0, retained: 0, ...customer.summary?.[0] };
  delete summary._id;
  summary.retentionRate = summary.previousActive ? 100 * summary.retained / summary.previousActive : 0;
  const top = rows => (rows || []).map(c => ({ name: c.fullName || "Unnamed customer", count: c.successful.count, value: c.successful.value }));
  return { generatedAt: now.toISOString(), period: p.public, capabilities: capabilities(req),
    overview: { registeredCustomers: summary.customers, activeCustomers: summary.active,
      newCustomers: summary.newRegistrations, inactiveCustomers: summary.inactive, neverCustomers: summary.never, ...tx.summary },
    customers: { summary, topCount: top(customer.topCount), topVolume: top(customer.topVolume) },
    transactions: tx, definitions: [
      "Transaction volume is successful customer movement, including funding and transfers; it is not earned revenue or profit.",
      "Transfer debit/credit counterparts remain separate customer activity records; these totals are not a reconciled single-sided transfer or sales ledger.",
      "Canonical references are deduplicated and recorded reversal links exclude the original from successful totals.",
      `Customer activity categories use all services over rolling ${cfg.activityDays}/${cfg.inactiveDays}-day windows; transaction service/status/provider filters do not redefine those categories.`,
      "New registrations, retention and transaction charts use the selected Lagos reporting period.",
      "BRM, CM and State Coordinator role mappings are unverified; existing Agent, State Manager and Zonal Manager names are retained.",
      "Reports are on-demand snapshots, not continuous availability or provider authorization checks.",
    ] };
}
async function finance(req, q = {}) {
  if (!capabilities(req).finance) throw fail("Authorized Head Office finance access is required.", 403);
  if (q.provider || q.status) throw fail("Finance supports date and service filters only; clear provider/status filters.", 400);
  const p = period(q), data = await require("./financialControl.service").summary({
    from: p.public.from, to: p.public.to, ...(q.serviceType && { service: q.serviceType }),
  });
  delete data.transactionRows; // Do not leak raw financial records through summary exports.
  return { ...data, walletLiabilities: null, fundingReconciliation: null, settlementLiabilities: null,
    limitations: [
      "Recorded revenue is a known subtotal, not proof of complete company revenue.",
      "Gross profit uses recorded historical costs and commissions; net profit remains unavailable without complete expense coverage.",
      "Cross-wallet liabilities, funding reconciliation and outstanding settlements are unavailable until source-specific custody evidence is reconciled.",
    ] };
}
async function marketing(req, q = {}) {
  if (!has(req, "marketing.view")) throw fail("Marketing reporting permission is required.", 403);
  const m = require("./marketing.service");
  if (!await m.ready()) throw fail("Existing marketing storage is not provisioned; no storage was created.", 503);
  await require("./marketingAccess.service").context(req);
  if (q.provider || q.status || q.serviceType) throw fail("Marketing uses date filters only; clear transaction filters.");
  const p = period(q);
  const data = await require("./marketingAnalytics.service").overview({ preset: "custom", from: p.start.toISOString(), to: p.end.toISOString() });
  const leadership = require("./marketingAccess.service").leadership(req);
  const departmentPerformance = leadership ? await require("./marketingPerformance.service").department(req, {
      period: q.targetPeriod || ({ today: "DAILY", yesterday: "DAILY", "7d": "WEEKLY", thisYear: "YEARLY" }[q.range] || "MONTHLY"),
      from: p.start.toISOString(), to: p.end.toISOString(),
    }) : { available: false, reason: "Existing marketing leadership permission is required for staff performance details." };
  return { ...data, departmentPerformance, period: p.public,
    targetPeriods: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] };
}
async function health(req, q = {}) {
  const p = period(q), start = Date.now();
  await mongoose.connection.db.command({ ping: 1, maxTimeMS: 3000 });
  const latencyMs = Date.now() - start;
  const providers = await Transaction.aggregate([{ $match: { createdAt: { $gte: p.start, $lt: p.end }, isTest: { $ne: true } } },
    { $group: { _id: { $ifNull: ["$provider", "UNRECORDED"] }, recordedTransactions: { $sum: 1 },
      recordedPending: count({ $in: ["$status", ["PENDING", "PROCESSING", "UNKNOWN"]] }),
      recordedFailed: count({ $eq: ["$status", "FAILED"] }) } }, { $sort: { recordedTransactions: -1, _id: 1 } },
    { $limit: 100 }]).option({ maxTimeMS: 5000 });
  const errors = await Audit.find({ status: { $in: ["FAILED", "FAILURE"] }, createdAt: { $gte: p.start, $lt: p.end } })
    .select("-_id action status createdAt").sort({ createdAt: -1 }).limit(20).lean().maxTimeMS(5000);
  return { generatedAt: new Date().toISOString(), backend: { status: "AVAILABLE" },
    database: { status: "CONNECTED", latencyMs },
    providers: providers.map(({ _id, ...row }) => ({ provider: _id, ...row, status: "NOT_ACTIVELY_PROBED", responseTimeMs: null })),
    webhooks: { status: "UNAVAILABLE", reason: "No authenticated aggregate webhook-health source is available; unsigned callbacks are not financial authority." },
    errors: errors.map(e => ({ ...e, action: /^[A-Z0-9_]{1,120}$/.test(e.action) ? e.action : "ADMINISTRATIVE_ERROR" })),
    notice: "Availability is this request's observation. Provider rows and administrative errors use the selected dates, not transaction service/status/provider filters. These are bounded recorded evidence, not live provider probes or raw server logs. Missing latency is unavailable, never zero." };
}
module.exports = { period, filters, capabilities, canonical, transactions, overview, finance, marketing, health, fail };
