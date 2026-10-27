const mongoose = require("mongoose");
const Transaction = require("../models/transaction.model");
const Settings = require("../models/appSettings.model");
const Audit = require("../models/adminAuditLog.model");
const User = require("../models/user.model");

// Independent of announcement qualifications and every money-moving path.
const SERVICES = Object.freeze([
  "AIRTIME", "DATA", "CABLE", "ELECTRICITY", "EXAM_PIN", "DELIVERY",
  "INTERSTATE_LOGISTICS", "MARKETPLACE", "ID_VERIFICATION", "EDUPAY",
  "SOLAR_DEPOSIT", "SOLAR_INSTALLMENT", "PHONE_FINANCING_DEPOSIT",
  "PHONE_FINANCING_INSTALLMENT", "PROTECTED_DEAL",
]);
const DEFAULTS = { enabled: false, eligibleServices: SERVICES.slice(), minAmount: 0, revision: 0 };
const TTL = 60000;
const cache = new Map();
let building = false;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const currentMonth = (now = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit",
}).format(now);

function period(month = currentMonth()) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      month < "2010-01" || month > currentMonth()) throw failure("Choose a valid month between 2010 and the current Lagos month.");
  const [year, mm] = month.split("-").map(Number);
  return {
    month, timeZone: "Africa/Lagos",
    startAt: new Date(Date.UTC(year, mm - 1, 1, -1)),
    endAt: new Date(Date.UTC(year, mm, 1, -1)),
  };
}

async function settings() {
  const doc = await Settings.findOne({ key: "GLOBAL_SETTINGS" }).select("customerLeaderboard").lean();
  const saved = doc?.customerLeaderboard || {};
  return {
    ...DEFAULTS, ...saved, enabled: saved.enabled === true,
    eligibleServices: (saved.eligibleServices || DEFAULTS.eligibleServices).filter(x => SERVICES.includes(x)),
    availableServices: SERVICES,
  };
}

function validateSettings(body) {
  if (!body || Object.keys(body).some(k => !["enabled", "eligibleServices", "minAmount", "revision"].includes(k)) ||
      typeof body.enabled !== "boolean" || !Array.isArray(body.eligibleServices) ||
      !body.eligibleServices.length || body.eligibleServices.some(x => !SERVICES.includes(x)) ||
      new Set(body.eligibleServices).size !== body.eligibleServices.length ||
      typeof body.minAmount !== "number" || !Number.isFinite(body.minAmount) ||
      body.minAmount < 0 || body.minAmount > 1000000000 ||
      Math.abs(body.minAmount * 100 - Math.round(body.minAmount * 100)) > 0.00001 ||
      !Number.isSafeInteger(body.revision) || body.revision < 0) {
    throw failure("Provide enabled, approved eligible services, a non-negative minimum (at most two decimal places), and the current revision.");
  }
  return { enabled: body.enabled, eligibleServices: body.eligibleServices.slice(),
    minAmount: body.minAmount, revision: body.revision + 1 };
}

async function updateSettings(body, actor) {
  const config = validateSettings(body);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const match = { key: "GLOBAL_SETTINGS", $or: [
        { "customerLeaderboard.revision": body.revision },
        ...(body.revision === 0 ? [{ "customerLeaderboard.revision": { $exists: false } }] : []),
      ] };
      const previous = await Settings.findOneAndUpdate(match, { $set: {
        customerLeaderboard: { ...config, updatedAt: new Date(), updatedBy: actor._id },
      } }, { session, new: false }).lean();
      if (!previous) throw failure("Settings changed. Reload before saving.", 409);
      await Audit.create([{
        actorId: actor._id, actorRole: actor.role,
        action: "SYSTEM_SETTING_UPDATED",
        reason: "Customer leaderboard configuration updated; no financial rewards.",
        metadata: { module: "CUSTOMER_LEADERBOARD", before: previous.customerLeaderboard || DEFAULTS, after: config },
      }], { session });
    });
    cache.clear();
    return settings();
  } finally { await session.endSession(); }
}

// Same bounded refund/reversal-key semantics as the existing promo engine.
// Additional negative status evidence fails closed; existing promo rules stay untouched.
function invalidEvidence(value, key = "", depth = 0, budget = { left: 2000 }) {
  if (--budget.left < 0 || depth > 12) return true;
  if (value == null) return false;
  if (/refund|revers/i.test(key)) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }
  if (/(status|state|outcome|success)$/i.test(key) && (value === false ||
      (typeof value === "string" &&
      /^(pending|processing|unknown|failed|failure|error|false|refunded|reversed|cancelled|canceled)$/i.test(value.trim())))) return true;
  if (typeof value === "object") return Object.entries(value)
    .some(([k, v]) => invalidEvidence(v, k, depth + 1, budget));
  return false;
}
const POSITIVE = new Set(["SUCCESS", "SUCCESSFUL", "SUCCEEDED", "COMPLETED", "DELIVERED"]);
function confirmed(tx) {
  if (invalidEvidence(tx.providerResponse)) return false;
  if (!["AIRTIME", "DATA", "CABLE", "ELECTRICITY", "EXAM_PIN"].includes(tx.serviceType)) return true;
  const state = String(tx.providerStatus || "").toUpperCase();
  if (state && !POSITIVE.has(state) && state !== "UNKNOWN") return false;
  const dispatch = String(tx.dispatchStatus || "").toUpperCase();
  if (dispatch && !POSITIVE.has(dispatch)) return false;
  const response = tx.providerResponse || {};
  return POSITIVE.has(state) || POSITIVE.has(dispatch) ||
    [response.status, response.data?.status, response.data?.transaction_status]
      .some(x => x === true || POSITIVE.has(String(x).toUpperCase()));
}
function matchFor(p, config) {
  return {
    status: "SUCCESSFUL", serviceType: { $in: config.eligibleServices },
    createdAt: { $gte: p.startAt, $lt: p.endAt },
    amount: { $gte: Math.max(0.01, config.minAmount), $lte: Number.MAX_SAFE_INTEGER / 100, $type: "number" },
    $and: [
      { reversalTransactionId: null }, { reversedTransactionId: null },
      { $or: [{ reversalReference: null }, { reversalReference: "" }] },
      { "metadata.isTest": { $ne: true } }, { isTest: { $ne: true } },
    ],
  };
}
function maskedName(name) {
  const words = String(name || "").normalize("NFKC").match(/\p{L}+/gu) || [];
  // Only single initials: no numbers, phones, e-mails, full surnames or IDs.
  return words.length ? `${words[0][0].toLocaleUpperCase()}***${words[1] ? " " + words[1][0].toLocaleUpperCase() + "***" : ""}` : "Customer ***";
}
function consentedName(name, consent) {
  const full = typeof name === "string" ? name.trim() : "";
  // Consent is for a registered name, never contact data entered in that field.
  if (consent !== true || !full || /@|https?:\/\/|www\.|(?:\p{N}[\s()+.-]*){6}/iu.test(full)) {
    return maskedName(full);
  }
  return full;
}
async function privacy(customerId) {
  const user = await User.findOne({ _id: customerId, role: "CUSTOMER", status: "ACTIVE",
    isDeleted: { $ne: true }, activationPending: { $ne: true } })
    .select("championsShowFullName -_id").read("primary").lean().maxTimeMS(3000);
  if (!user) throw failure("Customer account is unavailable.", 404);
  return { showFullName: user.championsShowFullName === true };
}
async function updatePrivacy(customerId, body) {
  if (!body || Array.isArray(body) || typeof body !== "object" ||
      Object.keys(body).length !== 1 || typeof body.showFullName !== "boolean") {
    throw failure("Provide only showFullName as true or false.");
  }
  const user = await User.findOneAndUpdate({ _id: customerId, role: "CUSTOMER", status: "ACTIVE",
    isDeleted: { $ne: true }, activationPending: { $ne: true } },
  { $set: { championsShowFullName: body.showFullName, championsNameConsentUpdatedAt: new Date() } },
  { returnDocument: "after", runValidators: true }).select("championsShowFullName -_id").lean().maxTimeMS(3000);
  if (!user) throw failure("Customer account is unavailable.", 404);
  // Never invalidate/recalculate rankings for a display-only preference.
  return { showFullName: user.championsShowFullName === true };
}
async function currentNames(result, admin, limit, sort) {
  const ids = result.rows.filter(row => row.countRank <= 10 || row.valueRank <= 10 ||
    (admin && row[`${sort}Rank`] <= limit)).map(row => row.id);
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids }, role: "CUSTOMER", status: "ACTIVE",
    isDeleted: { $ne: true }, activationPending: { $ne: true } })
    .select("fullName championsShowFullName").read("primary").lean().maxTimeMS(3000);
  // Read consent on every response, outside the numerical ranking cache.
  // Opt-out must not wait for a cache TTL or a different server's invalidation.
  return new Map(users.map(user => [String(user._id),
    consentedName(user.fullName, user.championsShowFullName)]));
}
function pipeline(p, config, excluded) {
  const stages = [{ $match: { ...matchFor(p, config), _id: { $nin: excluded } } },
    { $project: { _id: 1, customerId: 1, serviceType: 1, provider: 1, reference: 1,
      providerRequestId: 1, providerReference: 1, idempotencyKey: 1, createdAt: 1, amount: 1 } },
    { $sort: { createdAt: 1, _id: 1 } }];
  // Use every durable identifier independently. Missing identifiers never
  // collapse unrelated transactions; service/customer isolate provider namespaces.
  for (const field of ["reference", "providerRequestId", "providerReference", "idempotencyKey"]) {
    stages.push({ $group: { _id: {
      customer: "$customerId", service: "$serviceType",
      ...(field.startsWith("provider") ? { provider: "$provider" } : {}),
      key: { $cond: [{ $and: [
        { $eq: [{ $type: `$${field}` }, "string"] }, { $ne: [`$${field}`, ""] },
      ] }, `$${field}`, "$_id"] },
    }, doc: { $first: "$$ROOT" } } }, { $replaceRoot: { newRoot: "$doc" } },
    { $sort: { createdAt: 1, _id: 1 } });
  }
  for (const field of ["reversedTransactionId", "reversalTransactionId"]) {
    stages.push({ $lookup: { from: "transactions", localField: "_id", foreignField: field, as: "reversal" } },
      { $match: { "reversal.0": { $exists: false } } });
  }
  stages.push(
    { $set: { kobo: { $round: [{ $multiply: [{ $toDecimal: "$amount" }, { $toDecimal: "100" }] }, 0] } } },
    { $group: { _id: "$customerId", count: { $sum: 1 }, kobo: { $sum: "$kobo" }, firstAt: { $min: "$createdAt" } } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "customer",
      pipeline: [{ $project: { fullName: 1, role: 1, status: 1, isDeleted: 1, activationPending: 1 } }] } },
    { $unwind: "$customer" },
    { $match: { "customer.role": "CUSTOMER", "customer.status": "ACTIVE",
      "customer.isDeleted": { $ne: true }, "customer.activationPending": { $ne: true } } },
    // $documentNumber accepts exactly one top-level sort field. Ordered BSON
    // objects retain all four deterministic tie-breakers without server JS.
    { $set: {
      countOrder: { primary: { $multiply: ["$count", -1] }, secondary: { $multiply: ["$kobo", -1] }, firstAt: "$firstAt", id: "$_id" },
      valueOrder: { primary: { $multiply: ["$kobo", -1] }, secondary: { $multiply: ["$count", -1] }, firstAt: "$firstAt", id: "$_id" },
    } },
    { $setWindowFields: { sortBy: { countOrder: 1 }, output: { countRank: { $documentNumber: {} } } } },
    { $setWindowFields: { sortBy: { valueOrder: 1 }, output: { valueRank: { $documentNumber: {} } } } },
    { $project: { _id: 1, count: 1, kobo: 1, countRank: 1, valueRank: 1, fullName: "$customer.fullName" } },
    { $limit: 10001 },
  );
  return stages;
}
async function calculate(p, config) {
  // Freeze both passes at one read-only snapshot. A payment settled between
  // the evidence scan and grouping must wait for the next report, not bypass
  // the evidence predicate. No payment records or database transaction writes.
  const session = await mongoose.startSession({ snapshot: true, causalConsistency: false });
  try {
  const excluded = [];
  let scanned = 0;
  const cursor = Transaction.find(matchFor(p, config))
    .select("_id serviceType providerStatus dispatchStatus providerResponse").session(session).lean().maxTimeMS(8000)
    .cursor({ batchSize: 100 });
  try {
    for await (const tx of cursor) {
      if (++scanned > 100000) throw failure("Monthly report exceeds the safe reporting limit.", 503);
      if (!confirmed(tx)) {
        excluded.push(tx._id);
        if (excluded.length > 10000) throw failure("Too many unresolved records for safe reporting.", 503);
      }
    }
  } finally { await cursor.close(); }
  const rows = await Transaction.aggregate(pipeline(p, config, excluded)).session(session).allowDiskUse(true).option({ maxTimeMS: 8000 });
  if (rows.length > 10000) throw failure("Monthly report exceeds the safe customer limit.", 503);
  return rows.map(row => {
    const kobo = Number(row.kobo.toString());
    if (!Number.isSafeInteger(kobo) || kobo < 0) throw failure("Transaction totals need reconciliation before ranking.", 503);
    return { id: String(row._id), displayName: maskedName(row.fullName), count: row.count,
      value: kobo / 100, countRank: row.countRank, valueRank: row.valueRank };
  });
  } finally { await session.endSession(); }
}
async function rankings(month, config) {
  const p = period(month), key = `${p.month}:${config.revision}`;
  const found = cache.get(key);
  if (found && found.until > Date.now()) {
    if (found.error) throw failure("Leaderboard is temporarily unavailable. Please retry shortly.", 503);
    return found.promise;
  }
  if (building) throw failure("Another leaderboard report is processing. Please retry shortly.", 503);
  building = true;
  const started = Date.now();
  const promise = calculate(p, config).then(rows => ({ rows, period: p,
    calculatedAt: new Date(started).toISOString(), cachedUntil: new Date(started + TTL).toISOString() }));
  cache.set(key, { until: started + TTL, promise });
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  try { return await promise; }
  catch (error) { cache.set(key, { until: Date.now() + 10000, error: true }); throw error; }
  finally { building = false; }
}
function view(result, customerId, limit = 10, sort = "count", names = new Map()) {
  const id = String(customerId || ""), { rows } = result;
  const safe = (row, metric) => ({ rank: row[`${metric}Rank`], displayName: names.get(row.id) ?? row.displayName,
    count: row.count, value: row.value, isMe: row.id === id });
  const ordered = metric => rows.slice().sort((a, b) => a[`${metric}Rank`] - b[`${metric}Rank`]);
  const mine = rows.find(x => x.id === id);
  const tenth = ordered("count")[9];
  return {
    enabled: true, period: result.period, calculatedAt: result.calculatedAt, cachedUntil: result.cachedUntil,
    countTop: ordered("count").slice(0, 10).map(x => safe(x, "count")),
    valueTop: ordered("value").slice(0, 10).map(x => safe(x, "value")),
    ...(customerId ? { me: {
      countRank: mine?.countRank || null, valueRank: mine?.valueRank || null,
      count: mine?.count || 0, value: mine?.value || 0,
      transactionsNeededToTop10: mine?.countRank <= 10 ? 0 : tenth ? Math.max(0, tenth.count - (mine?.count || 0) + 1) : 1,
    } } : { totalCustomers: rows.length, rows: ordered(sort).slice(0, limit).map(x => safe(x, sort)) }),
  };
}
async function report({ month, customerId, limit = 10, sort = "count", admin = false }) {
  const config = await settings(), p = period(month);
  if (!config.enabled && !admin) return { enabled: false, period: p, countTop: [], valueTop: [],
    me: { countRank: null, valueRank: null, count: 0, value: 0, transactionsNeededToTop10: 0 } };
  const result = await rankings(p.month, config);
  const data = view(result, customerId, limit, sort, await currentNames(result, admin, limit, sort));
  data.enabled = config.enabled;
  data.rules = { eligibleServices: config.eligibleServices, minAmount: config.minAmount,
    periodBasis: "createdAt", historyUsesCurrentRules: true,
    countTarget: "Additional purchases to exceed the current tenth customer's count; ties use value, earliest activity, then stable customer ID." };
  return data;
}
module.exports = { SERVICES, period, currentMonth, settings, validateSettings, updateSettings,
  report, view, pipeline, matchFor, maskedName, confirmed, invalidEvidence,
  privacy, updatePrivacy, consentedName,
  clearCache: () => cache.clear() };
