"use strict";

// Reporting only: no payment/provider calls, wallet writes, migrations or indexes.
const mongoose = require("mongoose");
const DAY = 86400000;
const DEFAULTS = Object.freeze({ frequentMin: 10, regularMin: 4, activityDays: 30, inactiveDays: 60, newDays: 30 });
const CATEGORIES = ["FREQUENT", "REGULAR", "OCCASIONAL", "DECLINING", "INACTIVE", "NEVER"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const oid = value => {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw fail("Invalid customer or assignment ID.");
  return new mongoose.Types.ObjectId(value);
};
function settings(value = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    const v = value[key] ?? DEFAULTS[key];
    if (!Number.isInteger(v) || v < 1 || v > (key.endsWith("Min") ? 100000 : 365)) throw fail(`Invalid ${key}.`);
    result[key] = v;
  }
  if (result.regularMin >= result.frequentMin || result.inactiveDays <= result.activityDays) {
    throw fail("Frequent must exceed Regular; inactivity must exceed the activity window.");
  }
  return result;
}
function date(value, end = false) {
  if (!value) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail("Dates must use YYYY-MM-DD.");
  const parsed = new Date(`${value}T00:00:00+01:00`);
  if (!Number.isFinite(+parsed) || new Date(+parsed + 3600000).toISOString().slice(0, 10) !== value) throw fail("Invalid date.");
  return new Date(+parsed + (end ? DAY : 0));
}
function scope(req) {
  const s = req.staffAccess?.scope;
  if (!s) throw fail("Customer data scope is unavailable.", 403);
  switch (String(s.type).toUpperCase()) {
    case "GLOBAL": return {};
    case "ZONE": if (s.zone) return { zone: s.zone }; break;
    case "STATE": if (s.zone && s.state) return { zone: s.zone, state: s.state }; break;
    case "BRANCH": return { branchId: oid(String(s.branchId)) };
    case "SELF": return { _id: oid(String(s.userId)) };
  }
  throw fail("Customer data scope is unsupported or incomplete.", 403);
}
function range(query, now) {
  const today = new Date(new Date(+now + 3600000).toISOString().slice(0, 10) + "T00:00:00+01:00");
  const key = query.range || "30d";
  let start, end = now;
  if (key === "today") start = today;
  else if (["7d", "30d", "90d"].includes(key)) start = new Date(+now - Number.parseInt(key) * DAY);
  else if (key === "thisMonth" || key === "lastMonth") {
    const local = new Date(+now + 3600000);
    const month = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 3600000);
    start = month;
    if (key === "lastMonth") {
      end = month;
      start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - 3600000);
    }
  } else if (key === "custom") { start = date(query.from); end = date(query.to, true); }
  else throw fail("Unsupported date range.");
  if (!start || !end || end <= start || end - start > 366 * DAY) throw fail("Choose a valid range of at most 366 days.");
  if (end > now) end = now;
  if (end <= start) throw fail("The reporting range must start in the past.");
  return { start, end, previous: new Date(+start - (end - start)) };
}
function classify({ count = 0, recentCount = 0, lastSuccess }, cfg = DEFAULTS, now = new Date()) {
  if (!count) return "NEVER";
  if (recentCount >= cfg.frequentMin) return "FREQUENT";
  if (recentCount >= cfg.regularMin) return "REGULAR";
  if (recentCount > 0) return "OCCASIONAL";
  return lastSuccess && now - new Date(lastSuccess) <= cfg.inactiveDays * DAY ? "DECLINING" : "INACTIVE";
}
function userMatch(req, q) {
  const clauses = [{ role: "CUSTOMER", isDeleted: { $ne: true } }, scope(req)];
  for (const key of ["state", "lga"]) if (q[key]) {
    if (typeof q[key] !== "string" || q[key].length > 100) throw fail(`Invalid ${key}.`);
    clauses.push({ [key]: q[key] });
  }
  for (const key of ["agentId", "stateManagerId", "zonalManagerId"]) if (q[key]) clauses.push({ [key]: oid(q[key]) });
  if (q.q) {
    if (typeof q.q !== "string" || q.q.length > 100) throw fail("Search must be at most 100 characters.");
    const pattern = q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clauses.push({ $or: ["fullName", "phone", "email"].map(k => ({ [k]: { $regex: pattern, $options: "i" } })) });
  }
  const from = date(q.registeredFrom), to = date(q.registeredTo, true);
  if (from && to && to <= from) throw fail("Invalid registration range.");
  if (from || to) clauses.push({ createdAt: { ...(from && { $gte: from }), ...(to && { $lt: to }) } });
  return { $and: clauses };
}
function selection(q) {
  const filter = {};
  if (q.category) {
    if (!CATEGORIES.includes(q.category)) throw fail("Invalid customer category.");
    filter.category = q.category;
  }
  if (q.newOnly === "true" || q.newOnly === true) filter.isNew = true;
  for (const [field, min, max] of [["recentCount", "minCount", "maxCount"], ["successful.value", "minValue", "maxValue"]]) {
    for (const [key, operator] of [[min, "$gte"], [max, "$lte"]]) if (q[key] !== undefined && q[key] !== "") {
      const value = Number(q[key]);
      if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw fail(`Invalid ${key}.`);
      filter[field] = { ...filter[field], [operator]: value };
    }
    if (filter[field]?.$gte > filter[field]?.$lte) throw fail("Minimum cannot exceed maximum.");
  }
  const from = date(q.lastFrom), to = date(q.lastTo, true);
  if (from && to && to <= from) throw fail("Invalid last transaction range.");
  if (from || to) filter.lastSuccess = { ...(from && { $gte: from }), ...(to && { $lt: to }) };
  if (q.status) {
    const key = { SUCCESSFUL: "successful", FAILED: "failed", PENDING: "pending", REFUNDED: "refunded", OTHER: "other" }[q.status];
    if (!key) throw fail("Invalid transaction status.");
    filter[`${key}.count`] = { $gt: 0 };
  }
  if (q.serviceType) filter["services._id"] = q.serviceType;
  return filter;
}
const sumIf = (condition, value = 1) => ({ $sum: { $cond: [condition, value, 0] } });
const bucketNames = { SUCCESSFUL: "successful", FAILED: "failed", PENDING: "pending", REFUNDED: "refunded", OTHER: "other" };
const zero = { count: 0, value: 0 };
function deduplicate() {
  // Reuse the leaderboard's identifier namespaces, but keep the latest
  // canonical status. Propagate reversal evidence conservatively across copies.
  return ["reference", "providerRequestId", "providerReference", "idempotencyKey"].flatMap(field => [
    { $sort: { updatedAt: -1, _id: -1 } },
    { $group: { _id: { customer: "$customerId", service: "$serviceType",
      ...(field.startsWith("provider") ? { provider: "$provider" } : {}),
      key: { $cond: [{ $and: [{ $eq: [{ $type: `$${field}` }, "string"] }, { $ne: [`$${field}`, ""] }] }, `$${field}`, "$_id"] } },
      tx: { $first: "$$ROOT" }, hasReversal: { $max: { $cond: [{ $or: [
        { $eq: ["$status", "REFUNDED"] }, { $eq: ["$_hasReversal", true] },
        { $ne: [{ $ifNull: ["$reversalTransactionId", null] }, null] },
        { $ne: [{ $ifNull: ["$reversalLedgerEntryId", null] }, null] },
        { $ne: [{ $ifNull: ["$reversalReference", ""] }, ""] },
        { $gt: [{ $size: { $ifNull: ["$_reversals", []] } }, 0] },
      ] }, 1, 0] } } } },
    { $replaceRoot: { newRoot: { $mergeObjects: ["$tx", { _hasReversal: { $eq: ["$hasReversal", 1] } }] } } },
  ]);
}
function pipeline(req, q, cfg, now = new Date()) {
  // Both union branches share this exact audience predicate. ID restrictions
  // added by profile/export callers therefore constrain BOTH branches.
  const audience = userMatch(req, q);
  const r = range(q, now);
  const activeSince = new Date(+now - cfg.activityDays * DAY);
  const inactiveSince = new Date(+now - cfg.inactiveDays * DAY);
  const txMatch = { createdAt: { $lte: now }, serviceType: { $nin: ["REFUND", "REFERRAL_BONUS", "REFERRAL_BONUS_REVERSAL", "PHONE_FINANCING_REFUND"] },
    isTest: { $ne: true }, "metadata.isTest": { $ne: true } };
  if (q.serviceType) {
    if (typeof q.serviceType !== "string" || !/^[A-Z_]{2,50}$/.test(q.serviceType)) throw fail("Invalid service.");
  }
  const period = { $and: [{ $gte: ["$createdAt", r.start] }, { $lt: ["$createdAt", r.end] }] };
  const success = { $eq: ["$_bucket", "SUCCESSFUL"] };
  const successfulPeriod = { $and: [success, period] };
  const totals = { _id: { customer: "$customerId", service: "$serviceType", bucket: "$_bucket" },
    count: { $sum: 1 }, value: { $sum: "$amount" },
    recentCount: sumIf({ $and: [success, { $gte: ["$createdAt", activeSince] }] }),
    periodCount: sumIf(successfulPeriod), periodValue: sumIf(successfulPeriod, "$amount"),
    previousCount: sumIf({ $and: [success, { $gte: ["$createdAt", r.previous] }, { $lt: ["$createdAt", r.start] }] }),
    firstInPeriod: { $min: { $cond: [successfulPeriod, "$createdAt", new Date("9999-12-31T00:00:00Z")] } },
    lastBeforePeriod: { $max: { $cond: [{ $and: [success, { $lt: ["$createdAt", r.start] }] }, "$createdAt", null] } },
    lastSuccess: { $max: { $cond: [success, "$createdAt", null] } } };
  const projection = { fullName: 1, phone: 1, email: 1, createdAt: 1, state: 1, lga: 1, agentId: 1, stateManagerId: 1, zonalManagerId: 1, branchId: 1 };
  // Aggregate the canonical ledger ONCE, not a full nested reporting pipeline
  // for every customer. The final join still enforces the actor's user scope.
  const ledger = [
      { $match: txMatch },
      { $project: { _id: 1, reference: 1, customerId: 1, serviceType: 1, provider: 1,
        providerRequestId: 1, providerReference: 1, idempotencyKey: 1,
        status: 1, amount: 1, createdAt: 1, updatedAt: 1, reversalTransactionId: 1,
        reversalLedgerEntryId: 1, reversalReference: 1 } },
      { $lookup: { from: "transactions", localField: "_id", foreignField: "reversedTransactionId", as: "_reversals", pipeline: [
        // Atlas has an existing partial index on ObjectId relationships.
        // This explicit predicate makes it eligible; without it MongoDB may
        // scan the whole ledger once per purchase. No index is created here.
        { $match: { reversedTransactionId: { $type: "objectId" }, status: "SUCCESSFUL" } },
        { $project: { _id: 1 } }, { $limit: 1 },
      ] } },
      ...deduplicate(),
      { $set: { _bucket: { $switch: { branches: [
        { case: { $or: [{ $eq: ["$_hasReversal", true] }, { $eq: ["$status", "REFUNDED"] }, { $ne: [{ $ifNull: ["$reversalTransactionId", null] }, null] },
          { $ne: [{ $ifNull: ["$reversalLedgerEntryId", null] }, null] }, { $ne: [{ $ifNull: ["$reversalReference", ""] }, ""] },
          { $gt: [{ $size: "$_reversals" }, 0] }] }, then: "REFUNDED" },
        { case: { $eq: ["$status", "SUCCESSFUL"] }, then: "SUCCESSFUL" },
        { case: { $eq: ["$status", "FAILED"] }, then: "FAILED" },
        { case: { $in: ["$status", ["PENDING", "PROCESSING", "UNKNOWN"]] }, then: "PENDING" },
      ], default: "OTHER" } } } },
      // Bound daily rows by the requested period, not lifetime transaction count.
      { $set: { _day: { $cond: [successfulPeriod,
        { $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone: "Africa/Lagos" } }, null] } } },
      { $group: { ...totals, _id: { ...totals._id, day: "$_day" } } },
  ];
  const serviceGroup = { _id: { customer: "$_id.customer", service: "$_id.service", bucket: "$_id.bucket" },
    count: { $sum: "$count" }, value: { $sum: "$value" },
    daily: { $push: { _id: "$_id.day", count: "$periodCount", value: "$periodValue" } },
    lastSuccess: { $max: "$lastSuccess" }, firstInPeriod: { $min: "$firstInPeriod" }, lastBeforePeriod: { $max: "$lastBeforePeriod" } };
  for (const k of ["recentCount", "periodCount", "periodValue", "previousCount"]) serviceGroup[k] = { $sum: `$${k}` };
  const customerGroup = { _id: "$_id.customer", _hasActivity: { $max: 1 },
    services: { $push: { _id: "$_id.service", bucket: "$_id.bucket", count: "$count", value: "$value" } },
    daily: { $push: "$daily" }, lastSuccess: { $max: "$lastSuccess" }, firstInPeriod: { $min: "$firstInPeriod" },
    lastBeforePeriod: { $max: "$lastBeforePeriod" } };
  for (const k of ["recentCount", "periodCount", "periodValue", "previousCount"]) customerGroup[k] = { $sum: `$${k}` };
  for (const [status, key] of Object.entries(bucketNames)) {
    customerGroup[`${key}Count`] = sumIf({ $eq: ["$_id.bucket", status] }, "$count");
    customerGroup[`${key}Value`] = sumIf({ $eq: ["$_id.bucket", status] }, "$value");
  }
  ledger.push({ $group: serviceGroup }, { $group: customerGroup },
    { $set: {
      _totals: "$$ROOT",
      services: { $sortArray: { input: { $filter: { input: "$services", as: "s", cond: { $eq: ["$$s.bucket", "SUCCESSFUL"] } } }, sortBy: { count: -1, _id: 1 } } },
      daily: { $filter: { input: { $reduce: { input: "$daily", initialValue: [], in: { $concatArrays: ["$$value", "$$this"] } } },
        as: "day", cond: { $ne: ["$$day._id", null] } } },
    } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "_customer",
      pipeline: [{ $match: audience }, { $project: projection }] } },
    { $unwind: "$_customer" },
    { $replaceRoot: { newRoot: { $mergeObjects: ["$_customer", "$$ROOT"] } } },
    { $unset: "_customer" });
  const output = [
    { $match: audience }, { $project: projection },
    { $set: { _hasActivity: 0, _totals: {}, services: [], daily: [] } },
    { $unionWith: { coll: "transactions", pipeline: ledger } },
    { $sort: { _hasActivity: -1, _id: 1 } },
    { $group: { _id: "$_id", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },
  ];
  const fields = { recentCount: { $ifNull: ["$_totals.recentCount", 0] }, periodCount: { $ifNull: ["$_totals.periodCount", 0] },
    periodValue: { $ifNull: ["$_totals.periodValue", 0] }, previousCount: { $ifNull: ["$_totals.previousCount", 0] },
    firstInPeriod: { $ifNull: ["$_totals.firstInPeriod", null] },
    lastSuccess: { $ifNull: ["$_totals.lastSuccess", null] },
    lastBeforePeriod: { $ifNull: ["$_totals.lastBeforePeriod", null] },
    mostUsedService: { $ifNull: [{ $arrayElemAt: ["$services._id", 0] }, null] },
    isNew: { $gte: ["$createdAt", new Date(+now - cfg.newDays * DAY)] } };
  for (const key of Object.values(bucketNames)) fields[key] = { count: { $ifNull: [`$_totals.${key}Count`, 0] }, value: { $ifNull: [`$_totals.${key}Value`, 0] } };
  output.push({ $set: fields }, { $set: {
    category: { $switch: { branches: [
      { case: { $eq: ["$successful.count", 0] }, then: "NEVER" },
      { case: { $gte: ["$recentCount", cfg.frequentMin] }, then: "FREQUENT" },
      { case: { $gte: ["$recentCount", cfg.regularMin] }, then: "REGULAR" },
      { case: { $gt: ["$recentCount", 0] }, then: "OCCASIONAL" },
      { case: { $gte: ["$lastSuccess", inactiveSince] }, then: "DECLINING" },
    ], default: "INACTIVE" } },
    daysSinceLastSuccess: { $cond: [{ $ne: ["$lastSuccess", null] }, { $floor: { $divide: [{ $subtract: [now, "$lastSuccess"] }, DAY] } }, null] },
  } }, { $unset: ["_totals", "_hasActivity"] }, { $match: selection(q) });
  return { stages: output, range: r };
}
function page(q) {
  const p = Number(q.page || 1), limit = Number(q.limit || 25);
  if (!Number.isInteger(p) || p < 1 || p > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid page or page size.");
  return { page: p, limit, skip: (p - 1) * limit };
}
const sort = q => q.sort === "count" ? { "successful.count": -1, _id: 1 } :
  q.sort === "value" ? { "successful.value": -1, _id: 1 } : { createdAt: -1, _id: 1 };
const thin = { $project: { daily: 0, services: 0 } };
function facets(q, cfg = DEFAULTS, reportingRange = null) {
  const pg = page(q);
  const group = { _id: null, customers: { $sum: 1 }, active: sumIf({ $gt: ["$recentCount", 0] }), newCustomers: sumIf("$isNew"),
    previousActive: sumIf({ $gt: ["$previousCount", 0] }), retained: sumIf({ $and: [{ $gt: ["$previousCount", 0] }, { $gt: ["$periodCount", 0] }] }),
    reactivated: sumIf({ $and: [{ $gt: ["$periodCount", 0] }, { $ne: ["$lastBeforePeriod", null] },
      { $gt: [{ $subtract: ["$firstInPeriod", "$lastBeforePeriod"] }, cfg.inactiveDays * DAY] }, { $eq: ["$previousCount", 0] }] }) };
  if (reportingRange) group.newRegistrations = sumIf({ $and: [
    { $gte: ["$createdAt", reportingRange.start] }, { $lt: ["$createdAt", reportingRange.end] },
  ] });
  for (const category of CATEGORIES) group[category.toLowerCase()] = sumIf({ $eq: ["$category", category] });
  return { $facet: {
    items: [thin, { $sort: sort(q) }, { $skip: pg.skip }, { $limit: pg.limit }],
    total: [{ $count: "count" }],
    summary: [{ $group: group }],
    topCount: [{ $match: { "successful.count": { $gt: 0 } } }, thin, { $sort: { "successful.count": -1, _id: 1 } }, { $limit: 100 }],
    topVolume: [{ $match: { "successful.count": { $gt: 0 } } }, thin, { $sort: { "successful.value": -1, _id: 1 } }, { $limit: 100 }],
    trend: [{ $unwind: "$daily" }, { $group: { _id: "$daily._id", count: { $sum: "$daily.count" }, value: { $sum: "$daily.value" } } }, { $sort: { _id: 1 } },
      { $project: { _id: 0, date: "$_id", count: 1, value: 1 } }],
  } };
}
module.exports = { DAY, DEFAULTS, CATEGORIES, fail, oid, settings, date, scope, range, classify, userMatch, selection, pipeline, page, sort, facets, zero };
