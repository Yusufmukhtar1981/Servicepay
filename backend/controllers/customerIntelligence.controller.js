"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Settings = require("../models/appSettings.model");
const LoginEvent = require("../models/loginSecurityEvent.model");
const Audit = require("../models/adminAuditLog.model");
const { MIME, writeExport } = require("../services/customerExport.service");
const I = require("../services/customerIntelligence.service");
const active = new Set();
const can = (req, permission) => req.staffAccess?.isHeadOffice === true ||
  (req.staffAccess?.permissions || []).some(p => p === "*" || p === permission);
const capabilities = req => ({
  canExport: can(req, "customers.export") || can(req, "marketing.customer_intelligence.export"),
  canConfigure: req.staffAccess?.isHeadOffice === true && can(req, "settings.update"),
  canPrepareCampaign: can(req, "marketing.campaigns.manage") &&
    (can(req, "customers.export") || can(req, "marketing.customer_intelligence.export")),
});
const run = stages => User.aggregate(stages).option({ maxTimeMS: 20000, allowDiskUse: false });
const config = async () => I.settings((await Settings.findOne({ key: "GLOBAL_SETTINGS" })
  .select("customerIntelligence").lean().maxTimeMS(5000))?.customerIntelligence);
const pagination = (pg, total) => ({ page: pg.page, limit: pg.limit, total, totalPages: Math.max(1, Math.ceil(total / pg.limit)) });
const wrap = fn => async (req, res) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  const key = String(req.user?._id || req.user?.id);
  if (active.has(key) || active.size >= 3) return res.status(429).json({ success: false, message: "Analytics is busy. Please retry shortly." });
  active.add(key);
  // Release after the response is delivered, not after asynchronous temp-file
  // cleanup: the next legitimate download must not see a stale busy lease.
  let released = false;
  const release = () => { if (!released) { released = true; active.delete(key); } };
  res.once("finish", release);
  try { await fn(req, res); }
  catch (error) {
    if (!res.headersSent && !res.destroyed) res.status(error.status || 503).json({
      success: false, message: error.status ? error.message : "Customer Intelligence is temporarily unavailable. Please narrow your filters and retry.",
    });
  } finally { res.off("finish", release); release(); }
};
async function decorate(rows) {
  const ids = [...new Set(rows.flatMap(row => ["agentId", "stateManagerId", "zonalManagerId"]
    .map(key => row[key]?.toString()).filter(Boolean)))];
  const people = ids.length ? await User.find({ _id: { $in: ids } }).select("_id fullName").lean().maxTimeMS(5000) : [];
  const names = new Map(people.map(p => [String(p._id), p.fullName || ""]));
  return rows.map(row => {
    const result = { ...row };
    for (const [key, field] of [["agent", "agentId"], ["stateManager", "stateManagerId"], ["zonalManager", "zonalManagerId"]]) {
      result[key] = row[field] ? { id: String(row[field]), name: names.get(String(row[field])) || "Unavailable" } : null;
    }
    return result;
  });
}
function definitions(cfg) {
  return {
    categories: `Rolling ${cfg.activityDays}-day successful activity; Declining after that window through ${cfg.inactiveDays} days, Inactive beyond ${cfg.inactiveDays} days. Never means no unreversed successful canonical transactions.`,
    newCustomers: `Registered within ${cfg.newDays} days; an overlay, not an extra exclusive category.`,
    topCustomers: "Top 100 by lifetime unreversed successful count or value within the selected customer filters.",
    serviceFilter: "Selects customers who have used the service successfully; categories and lifetime totals still cover all services.",
    countFilter: `Successful transactions during the last ${cfg.activityDays} days.`,
    amountFilter: "Lifetime unreversed successful transaction value, in NGN; not revenue or wallet balance.",
    period: "Date selection controls trend, period totals, registrations, retention and reactivation; activity categories remain rolling.",
    retention: "Customers successful in both the selected and immediately preceding equal-length period / customers successful in the preceding period.",
    reactivated: `Successful in the selected period after a gap exceeding ${cfg.inactiveDays} days, with no success in the preceding period.`,
    statuses: "Canonical ServicePay transaction statuses, not a fresh provider verification. Reversed/refunded purchases are not successful activity.",
    exclusions: "Refund/reward bookkeeping and marked test rows excluded; historical missing transaction relationships are not inferred.",
    attribution: "Current stored customer assignments, not historical financial custody. BRM/CM mappings are not defined in the existing schema.",
    exports: "Authorized names, phone numbers and email addresses only. No financial, identity or credential export.",
  };
}
exports.customers = wrap(async (req, res) => {
  const cfg = await config(), now = new Date(), q = req.query, pg = I.page(q);
  const built = I.pipeline(req, q, cfg, now);
  const [result = {}] = await run([...built.stages, I.facets(q, cfg, built.range)]);
  const summary = { customers: 0, active: 0, frequent: 0, regular: 0, occasional: 0, declining: 0, inactive: 0, never: 0,
    newCustomers: 0, retained: 0, previousActive: 0, reactivated: 0, ...result.summary?.[0] };
  delete summary._id;
  summary.retentionRate = summary.previousActive ? summary.retained * 100 / summary.previousActive : 0;
  const items = await decorate(result.items || []);
  res.json({ success: true, data: {
    items, pagination: pagination(pg, result.total?.[0]?.count || 0), summary,
    topCount: await decorate(result.topCount || []), topVolume: await decorate(result.topVolume || []),
    trend: result.trend || [], settings: cfg, capabilities: capabilities(req), definitions: definitions(cfg),
    range: built.range, generatedAt: now,
  } });
});
exports.profile = wrap(async (req, res) => {
  const id = I.oid(req.params.id), cfg = await config(), pg = I.page(req.query);
  const built = I.pipeline(req, { range: req.query.range || "90d", from: req.query.from, to: req.query.to }, cfg);
  // Put identity in the first match, before any joins; never return out-of-scope profiles.
  built.stages[0].$match.$and.push({ _id: id });
  const [row] = await run(built.stages);
  if (!row) throw I.fail("Customer not found in your data scope.", 404);
  const [transactions, total, login, origin] = await Promise.all([
    Transaction.find({ customerId: id }).select("_id reference serviceType status amount createdAt")
      .sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).lean().maxTimeMS(10000),
    Transaction.countDocuments({ customerId: id }).maxTimeMS(10000),
    LoginEvent.findOne({ user: id, outcome: "SUCCESS" }).select("createdAt").sort({ createdAt: -1 }).lean().maxTimeMS(5000),
    User.findById(id).select("createdByPartner createdByUserId createdByStaffId").lean().maxTimeMS(5000),
  ]);
  const customer = (await decorate([row]))[0];
  // At most one reporting-period row per day/service, never raw transactions.
  const days = new Map();
  for (const v of row.daily) {
    const entry = days.get(v._id) || { date: v._id, count: 0, value: 0 };
    entry.count += v.count; entry.value += v.value; days.set(v._id, entry);
  }
  const frequency = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const timeline = [{ date: row.createdAt, event: "Customer registered" },
    ...(login ? [{ date: login.createdAt, event: "Latest recorded successful login" }] : []),
    ...transactions.map(t => ({ date: t.createdAt, event: `${t.serviceType}: ${t.status}`, reference: t.reference }))];
  timeline.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  delete customer.daily; delete customer.services;
  res.json({ success: true, data: { customer, transactions, pagination: pagination(pg, total),
    frequency, services: row.services.map(v => ({ serviceType: v._id, count: v.count, value: v.value })),
    timeline, timelineCoverage: "Registration, latest successful login and this transaction-history page.",
    lastLogin: login?.createdAt || null,
    registrationSource: origin?.createdByPartner ? "BUSINESS_PARTNER" : origin?.createdByStaffId ? "STAFF" :
      origin?.createdByUserId ? "REGISTERING_USER" : null,
  } });
});
exports.performance = wrap(async (req, res) => {
  const q = req.query, pg = I.page(q), cfg = await config();
  const dimension = { agent: "agentId", stateManager: "stateManagerId", zonalManager: "zonalManagerId" }[q.dimension || "agent"];
  if (!dimension) throw I.fail("Select a verified Agent, State Manager or Zonal Manager dimension. BRM/CM mappings are unavailable.");
  const built = I.pipeline(req, q, cfg);
  const [result = {}] = await run([...built.stages, { $match: { [dimension]: { $ne: null } } },
    { $group: { _id: `$${dimension}`, registered: { $sum: 1 }, transacted: { $sum: { $cond: [{ $gt: ["$successful.count", 0] }, 1, 0] } },
      never: { $sum: { $cond: [{ $eq: ["$successful.count", 0] }, 1, 0] } },
      active: { $sum: { $cond: [{ $gt: ["$recentCount", 0] }, 1, 0] } },
      inactive: { $sum: { $cond: [{ $eq: ["$category", "INACTIVE"] }, 1, 0] } }, value: { $sum: "$successful.value" },
      previousActive: { $sum: { $cond: [{ $gt: ["$previousCount", 0] }, 1, 0] } },
      retained: { $sum: { $cond: [{ $and: [{ $gt: ["$previousCount", 0] }, { $gt: ["$periodCount", 0] }] }, 1, 0] } } } },
    { $facet: { total: [{ $count: "count" }], items: [{ $sort: { registered: -1, _id: 1 } }, { $skip: pg.skip }, { $limit: pg.limit },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "_person", pipeline: [{ $project: { fullName: 1 } }] } },
      { $set: { id: "$_id", name: { $ifNull: [{ $arrayElemAt: ["$_person.fullName", 0] }, "Unavailable"] },
        retentionRate: { $cond: [{ $gt: ["$previousActive", 0] }, { $multiply: [{ $divide: ["$retained", "$previousActive"] }, 100] }, 0] } } },
      { $unset: "_person" }] } }]);
  res.json({ success: true, data: { items: result.items || [], pagination: pagination(pg, result.total?.[0]?.count || 0),
    unavailableDimensions: ["BRM", "CM"], attribution: definitions(cfg).attribution } });
});
exports.updateSettings = wrap(async (req, res) => {
  if (!capabilities(req).canConfigure) throw I.fail("Only Head Office with settings.update can change reporting thresholds.", 403);
  const next = I.settings(req.body), reason = String(req.body.reason || "").trim();
  if (reason.length < 10 || reason.length > 500) throw I.fail("Provide a reason of 10–500 characters.");
  const session = await Settings.startSession();
  try {
    await session.withTransaction(async () => {
      const old = await Settings.findOneAndUpdate({ key: "GLOBAL_SETTINGS" }, { $set: { customerIntelligence: next } },
        { returnDocument: "before", session, runValidators: true });
      if (!old) throw I.fail("Existing Admin Settings are required; no settings record was created.", 409);
      await Audit.create([{ actorId: req.user._id || req.user.id, actorRole: req.user.role,
        action: "SYSTEM_SETTING_UPDATED", reason,
        metadata: { module: "CUSTOMER_INTELLIGENCE", before: I.settings(old.customerIntelligence), after: next }, status: "SUCCESSFUL" }], { session });
    });
  } finally { await session.endSession(); }
  res.json({ success: true, data: next });
});
function selectedPipeline(req, cfg) {
  const body = req.body || {}, filters = body.filters || {};
  if (typeof filters !== "object" || Array.isArray(filters)) throw I.fail("Invalid filters.");
  const built = I.pipeline(req, filters, cfg);
  if (body.allFiltered !== true) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 10000) throw I.fail("Select customers or all filtered customers.");
    built.stages[0].$match.$and.push({ _id: { $in: [...new Set(body.ids)].map(I.oid) } });
  }
  return built.stages;
}
async function selectedCount(req, stages) {
  const [row] = await run([...stages, { $count: "count" }]);
  const count = row?.count || 0;
  if (!count) throw I.fail("No eligible customers match this selection.");
  if (count > 10000) throw I.fail("Narrow the selection to at most 10,000 customers.");
  if (req.body.allFiltered !== true && count !== new Set(req.body.ids).size) throw I.fail("Some selected customers are outside the current filters or your data scope.", 403);
  return count;
}
exports.export = wrap(async (req, res) => {
  if (!capabilities(req).canExport) throw I.fail("Customer export permission is required.", 403);
  const { format, action } = req.body || {};
  if (!Object.hasOwn(MIME, format) || !["download", "print", "share"].includes(action) || (action === "print" && format !== "pdf")) throw I.fail("Invalid export format or action.");
  const stages = selectedPipeline(req, await config());
  const count = await selectedCount(req, stages);
  let directory, cursor;
  const aborter = new AbortController();
  const onClose = () => { if (!res.writableFinished) aborter.abort(); };
  res.on("close", onClose);
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "servicepay-intelligence-"));
    await fs.chmod(directory, 0o700);
    const filename = `Servicepay-Customer-Intelligence.${format}`;
    cursor = User.aggregate([...stages, { $project: { _id: 0, fullName: 1, phone: 1, email: 1 } }, { $limit: 10001 }])
      .option({ maxTimeMS: 60000, allowDiskUse: false }).cursor({ batchSize: 100 });
    const written = await writeExport(path.join(directory, filename), format, cursor, aborter.signal);
    if (written !== count) throw I.fail("Customer selection changed while exporting. Refresh and retry.", 409);
    await Audit.create({ actorId: req.user._id || req.user.id, actorRole: req.user.role, action: "DATA_EXPORT_CREATED",
      reason: "Customer Intelligence contact export", status: "SUCCESSFUL",
      metadata: { dataset: "CUSTOMER_CONTACTS", module: "CUSTOMER_INTELLIGENCE", rowCount: written, format, action } });
    res.type(MIME[format]);
    await new Promise((resolve, reject) => res.download(path.join(directory, filename), filename, err => err ? reject(err) : resolve()));
  } finally {
    res.off("close", onClose);
    if (cursor) await cursor.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});
exports.campaignPreview = wrap(async (req, res) => {
  if (!capabilities(req).canPrepareCampaign) throw I.fail("Campaign management and customer export permissions are required.", 403);
  const { purpose, message } = req.body || {};
  if (!["WELCOME", "FIRST_TRANSACTION", "REACTIVATE", "REWARD", "DECLINING"].includes(purpose) ||
    typeof message !== "string" || message.trim().length < 10 || message.length > 2000) throw I.fail("Select a purpose and write a 10–2,000 character draft.");
  const stages = selectedPipeline(req, await config()), count = await selectedCount(req, stages);
  await Audit.create({ actorId: req.user._id || req.user.id, actorRole: req.user.role, action: "SYSTEM_SETTING_UPDATED",
    reason: "Prepared customer segment campaign draft; no messages sent", status: "SUCCESSFUL",
    metadata: { module: "CUSTOMER_INTELLIGENCE", purpose, selectedCount: count, dispatchEnabled: false } });
  res.json({ success: true, data: { purpose, message: message.trim(), selectedCount: count, dispatchEnabled: false, excludedOptOuts: null,
    warning: "Draft only. No messaging integration is enabled here. Consent and opt-out evidence are unavailable for this selection; no recipient is approved for sending. Verify consent, suppression lists, permissions and an authorized communication provider before dispatch." } });
});
exports._test = { capabilities, definitions, selectedPipeline, selectedCount };
