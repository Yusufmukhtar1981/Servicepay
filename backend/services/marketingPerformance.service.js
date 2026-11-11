"use strict";
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Record, fail, id, mutate, audit } = require("./marketing.service");
const access = require("./marketingAccess.service");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const PERIODS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const METRICS = ["ACQUISITIONS", "FIRST_TRANSACTIONS", "TASKS", "REPORTS", "CONTENT",
  "ATTENDANCE", "CAMPAIGNS", "ENGAGEMENT", "PARTNERSHIPS", "CUSTOM",
  "NEW_REGISTRATIONS", "AGENT_ACQUISITIONS", "MERCHANT_ACQUISITIONS"];
const WEIGHTS = { achievement: 40, acquisitions: 15, firstTransactions: 15, tasks: 10,
  reportCompliance: 10, campaigns: 10 };
const POLICY_ID = new mongoose.Types.ObjectId("6d61726b6574696e67706f6c");
const SERVICES = ["DATA", "AIRTIME", "ELECTRICITY", "CABLE", "EXAM_PIN",
  "DELIVERY", "ID_VERIFICATION", "INTERSTATE_LOGISTICS", "EDUPAY"];
function bounds(period = "DAILY", at = new Date()) {
  if (!PERIODS.includes(period)) throw fail("Choose DAILY, WEEKLY, MONTHLY or YEARLY.");
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  let end;
  if (period === "WEEKLY") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === "MONTHLY") start.setUTCDate(1);
  if (period === "YEARLY") { start.setUTCMonth(0, 1); }
  end = new Date(start);
  if (period === "DAILY") end.setUTCDate(end.getUTCDate() + 1);
  if (period === "WEEKLY") end.setUTCDate(end.getUTCDate() + 7);
  if (period === "MONTHLY") end.setUTCMonth(end.getUTCMonth() + 1);
  if (period === "YEARLY") end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { period, from: start, to: end };
}
function dates(query = {}) {
  const period = query.period || "MONTHLY";
  const result = bounds(period);
  if (query.from || query.to) {
    result.from = new Date(query.from); result.to = new Date(query.to);
    if (!Number.isFinite(+result.from) || !Number.isFinite(+result.to) ||
      result.from >= result.to || result.to - result.from > 366 * 86400000) throw fail("Choose an ordered date range of at most 366 days.");
  }
  return result;
}
async function bounded(query, max = 5000) {
  const rows = await query.limit(max + 1).lean();
  if (rows.length > max) throw fail("Reporting capacity exceeded; narrow the period.", 422);
  return rows;
}
async function policy() {
  const row = await Record.findById(POLICY_ID).lean();
  return { weights: row?.data.weights || WEIGHTS, revision: row?.revision ?? 0,
    version: row ? String(row._id) + ":" + row.revision : "default-1",
    methodology: [
      "UTC half-open date ranges. Each customer has one immutable attribution and one earliest qualifying successful service transaction.",
      "Self-reported counts never establish verified achievements. Completed assignments require manager confirmation.",
      "Daily, weekly, monthly and yearly targets are independent; their totals are never summed into a customer count.",
      "Achievement is the equal-weight mean of supported target percentages capped at 100. Custom KPIs and unverified engagement remain unavailable.",
      "Other score components are normalized to the highest verified value in this selected cohort; compliance uses submitted daily reports / elapsed UTC calendar days.",
      "Rankings require at least one measurable assigned target. Missing evidence is unavailable, not invented performance.",
    ] };
}
async function notify(req, session, owner, event, record, message, suffix = "") {
  if (!owner) return;
  const digest = crypto.createHash("sha256")
    .update(`${owner}:${event}:${record._id}:${record.revision || 0}:${suffix}`).digest("hex");
  const requestKey = "notice_" + digest;
  if (await Record.exists({ createdBy: owner, requestKey }).session(session)) return;
  await Record.create([{ kind: "notification", title: message.slice(0, 180),
    status: "UNREAD", officerId: owner, createdBy: owner, updatedBy: req.user._id,
    requestKey, data: { event, recordId: String(record._id), message, occurredAt: new Date().toISOString() } }], { session });
}
async function staff(req, requested) {
  const selected = requested ? id(requested) : req.user._id;
  if (!req.staffAccess.isHeadOffice && !(req.marketingOwners || [req.user._id])
    .some(v => String(v) === String(selected))) throw fail("Staff performance not found.", 404);
  const user = await User.findOne({ _id: selected, isStaff: true, department: "MARKETING" })
    .select("_id fullName email phone status createdAt staffRoleId").populate("staffRoleId", "name").lean();
  if (!user) {
    // A Head Office viewer has no personal marketing targets unless assigned a
    // real marketing staff identity. Do not fabricate one.
    throw fail("Select an existing marketing staff member.", 404);
  }
  return user;
}
async function measure(officerId, from, to) {
  const date = { $gte: from, $lt: to };
  const attributions = await bounded(Record.find({ kind: "attribution", status: "CONFIRMED", officerId })
    .select("customerId createdAt"));
  const customers = await bounded(User.find({ _id: { $in: attributions.map(a => a.customerId) }, role: "CUSTOMER" })
    .select("_id createdAt"));
  const customerIds = new Set(customers.map(c => String(c._id)));
  const first = await Transaction.aggregate([
    { $match: { customerId: { $in: customers.map(c => c._id) }, status: "SUCCESSFUL",
      serviceType: { $in: SERVICES }, reversalTransactionId: null, reversalReference: { $in: ["", null] } } },
    { $group: { _id: "$customerId", firstAt: { $min: "$createdAt" } } },
    { $match: { firstAt: date } },
  ]).option({ maxTimeMS: 15000 });
  const owner = { $or: [{ officerId }, { officerId: null, createdBy: officerId }] };
  const records = await bounded(Record.find({ ...owner,
    kind: { $in: ["task", "report", "content", "attendance", "campaign", "partnership"] } }));
  const inRange = value => value && new Date(value) >= from && new Date(value) < to;
  const verifiedTime = r => r.data.completedAt || r.data.lastDecisionAt;
  const dailyReports = records.filter(r => r.kind === "report" && r.data.period === "DAILY" &&
    r.status !== "DRAFT" && inRange(r.data.startsAt));
  const reportDates = new Set(dailyReports.map(r => new Date(r.data.startsAt).toISOString().slice(0, 10)));
  const currentDayEnd = bounds("DAILY").to;
  const employee = await User.findById(officerId).select("createdAt").lean();
  const joinedDay = employee ? bounds("DAILY", employee.createdAt).from : from;
  const reportingStart = Math.max(+from, +joinedDay);
  const elapsedDays = Math.max(0, Math.ceil((Math.min(+to, +currentDayEnd) - reportingStart) / 86400000));
  const verified = {
    NEW_REGISTRATIONS: new Set(customers.filter(c => inRange(c.createdAt)).map(c => String(c._id))).size,
    ACQUISITIONS: new Set(attributions.filter(a => customerIds.has(String(a.customerId)) &&
      inRange(a.createdAt)).map(a => String(a.customerId))).size,
    FIRST_TRANSACTIONS: first.length,
    TASKS: records.filter(r => r.kind === "task" && r.status === "COMPLETED" &&
      r.data.lastDecisionBy && r.data.lastDecisionBy !== String(r.officerId || r.createdBy) && inRange(verifiedTime(r))).length,
    REPORTS: records.filter(r => r.kind === "report" && r.status === "APPROVED" &&
      inRange(r.data.startsAt)).length,
    CONTENT: records.filter(r => r.kind === "content" && r.status === "PUBLISHED" &&
      r.data.publishedUrl && r.data.lastDecisionBy && inRange(r.data.publishedAt)).length,
    ATTENDANCE: null,
    CAMPAIGNS: records.filter(r => r.kind === "campaign" && r.status === "COMPLETED" &&
      r.data.lastDecisionBy && r.data.lastDecisionBy !== String(r.officerId || r.createdBy) && inRange(verifiedTime(r))).length,
    ENGAGEMENT: null,
    PARTNERSHIPS: records.filter(r => r.kind === "partnership" && ["APPROVED", "COMPLETED"].includes(r.status) &&
      r.data.lastDecisionBy && r.data.lastDecisionBy !== String(r.officerId || r.createdBy) && inRange(r.data.lastDecisionAt)).length,
    CUSTOM: null,
  };
  return { verified, reportCompliance: elapsedDays ? Math.min(100, reportDates.size / elapsedDays * 100) : null,
    submittedDays: reportDates.size, expectedDays: elapsedDays };
}
async function targetResult(target, cache = new Map(), now = new Date()) {
  const from = new Date(target.data.startsAt), to = new Date(target.data.endsAt);
  const owner = target.officerId;
  const department = target.data.scope === "DEPARTMENT";
  if ((!owner && !department) || !Number.isFinite(+from) || !Number.isFinite(+to)) return {
    ...target, actual: null, achievementPercent: null, remaining: null, outcome: "UNAVAILABLE" };
  const key = `${department ? "DEPARTMENT" : owner}:${+from}:${+to}`;
  if (!cache.has(key)) cache.set(key, department ? await departmentMeasure(from, to) : await measure(owner, from, to));
  const actual = cache.get(key).verified[target.data.metric] ?? null;
  const percentage = actual == null ? null : actual / target.data.value * 100;
  return { ...target, actual, achievementPercent: percentage,
    remaining: actual == null ? null : Math.max(0, target.data.value - actual),
    outcome: ["PAUSED", "INACTIVE"].includes(target.status) ? target.status :
      actual == null ? "UNAVAILABLE" : actual >= target.data.value ? "COMPLETED" :
      now >= to ? "MISSED" : now < from ? "PENDING" : "IN_PROGRESS" };
}
async function departmentMeasure(from, to) {
  const members = await bounded(User.find({ isStaff: true, department: "MARKETING" }).select("_id"), 500);
  const verified = Object.fromEntries(METRICS.map(k => [k, null]));
  for (const member of members) {
    const measured = await measure(member._id, from, to);
    for (const [metric, value] of Object.entries(measured.verified)) {
      if (value != null) verified[metric] = (verified[metric] ?? 0) + value;
    }
  }
  for (const metric of ["NEW_REGISTRATIONS", "ACQUISITIONS", "FIRST_TRANSACTIONS", "TASKS", "REPORTS", "CONTENT", "CAMPAIGNS", "PARTNERSHIPS"]) {
    if (!members.length) verified[metric] = 0;
  }
  return { verified };
}
async function departmentTargets(cache = new Map()) {
  const targets = await bounded(Record.find({ kind: "target", "data.scope": "DEPARTMENT",
    "data.archivedAt": { $exists: false } }).sort({ createdAt: -1 }), 1000);
  const results = [];
  for (const row of targets) results.push(await targetResult(row, cache));
  return results;
}
async function dashboard(req, requested) {
  const user = await staff(req, requested), cache = new Map();
  const targets = await bounded(Record.find({ kind: "target", officerId: user._id }).sort({ createdAt: -1 }), 1000);
  const results = [];
  for (const target of targets) results.push(await targetResult(target, cache));
  const owner = { $or: [{ officerId: user._id }, { officerId: null, createdBy: user._id }] };
  const [tasks, reports, history, notifications, activities] = await Promise.all([
    bounded(Record.find({ kind: "task", ...owner }).sort({ createdAt: -1 }), 1000),
    Record.find({ kind: "report", ...owner }).sort({ createdAt: -1 }).limit(50).lean(),
    Record.find({ kind: "performance", ...owner }).sort({ createdAt: -1 }).limit(50).lean(),
    Record.find({ kind: "notification", officerId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Record.find({ kind: "activity", createdBy: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  return { staff: { id: user._id, name: user.fullName, email: user.email, phone: user.phone,
      status: user.status, role: user.staffRoleId?.name },
    periods: PERIODS.map(period => ({ ...bounds(period), targets: results.filter(t =>
      t.data.period === period && !t.data.archivedAt && new Date(t.data.startsAt) < bounds(period).to &&
      new Date(t.data.endsAt) > bounds(period).from) })),
    departmentTargets: await departmentTargets(cache),
    targets: results, tasks: tasks.map(t => ({ ...t,
      overdue: !["COMPLETED"].includes(t.status) && new Date(t.data.dueAt) < new Date() })),
    reports, history, notifications, recentActivities: activities,
    feedback: reports.flatMap(r => (r.data.reviews || []).map(v => ({ ...v, reportTitle: r.title }))),
    methodology: await policy() };
}
async function department(req, query, cache = new Map()) {
  if (!access.leadership(req)) throw fail("Department performance is manager-only.", 403);
  const period = dates(query), config = await policy();
  const users = await bounded(User.find({ isStaff: true, department: "MARKETING",
    ...(!req.staffAccess.isHeadOffice ? { _id: { $in: req.marketingOwners } } : {}) })
    .select("_id fullName email phone status createdAt staffRoleId").populate("staffRoleId", "name").sort({ fullName: 1 }), 500);
  const rows = [];
  for (const u of users) {
    const measured = await measure(u._id, period.from, period.to);
    cache.set(`${u._id}:${+period.from}:${+period.to}`, measured);
    // Independent periods are never blended together in the score.
    const targets = await bounded(Record.find({ kind: "target", officerId: u._id,
      "data.period": period.period, "data.startsAt": { $gte: period.from.toISOString() },
      "data.endsAt": { $lte: period.to.toISOString() } }), 1000);
    const results = [];
    for (const t of targets) results.push(await targetResult(t, cache));
    const supported = results.filter(t => t.achievementPercent != null &&
      ["ACTIVE", "COMPLETED"].includes(t.status) && !t.data.archivedAt);
    const achievement = supported.length ? supported.reduce((s, t) =>
      s + Math.min(100, t.achievementPercent), 0) / supported.length : null;
    const ownReports = await bounded(Record.find({ kind: "report", officerId: u._id,
      "data.startsAt": { $gte: period.from.toISOString(), $lt: period.to.toISOString() } }), 1000);
    rows.push({ id: u._id, name: u.fullName, email: req.staffAccess.isHeadOffice ? u.email : undefined,
      phone: req.staffAccess.isHeadOffice ? u.phone : undefined, role: u.staffRoleId?.name,
      status: u.status, achievement,
      acquisitions: measured.verified.ACQUISITIONS,
      firstTransactions: measured.verified.FIRST_TRANSACTIONS,
      tasks: measured.verified.TASKS, campaigns: measured.verified.CAMPAIGNS,
      reportCompliance: measured.reportCompliance,
      expectedReports: measured.expectedDays,
      outstandingReports: Math.max(0, measured.expectedDays - measured.submittedDays),
      submittedReports: ownReports.filter(r => r.status === "SUBMITTED").length,
      targets: results });
  }
  const maxima = {};
  for (const k of Object.keys(config.weights)) maxima[k] = Math.max(0, ...rows.map(r => r[k] || 0));
  for (const row of rows) {
    row.components = {};
    let total = 0, weight = 0;
    for (const [key, value] of Object.entries(config.weights)) {
      const normalized = row[key] == null ? null : ["achievement", "reportCompliance"].includes(key)
        ? row[key] : maxima[key] ? row[key] / maxima[key] * 100 : 0;
      row.components[key] = { verified: row[key], normalized, weight: value };
      if (normalized != null) { total += normalized * value; weight += value; }
    }
    row.score = row.achievement == null || !weight ? null : total / weight;
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.id).localeCompare(String(b.id)));
  let rank = 0, previous = null;
  rows.forEach((r, index) => { if (r.score == null) { r.rank = null; return; }
    if (r.score !== previous) rank = index + 1; previous = r.score; r.rank = rank; });
  return { period, items: rows, methodology: config, departmentTargets: await departmentTargets(cache),
    comparisonNote: "Choose a different date range or period to compare historical performance. No cross-period customer totals are added." };
}
async function snapshot(req, body) {
  if (!access.leadership(req)) throw fail("Only managers capture verified snapshots.", 403);
  const user = await staff(req, body.officerId), period = dates(body);
  const measured = await measure(user._id, period.from, period.to), config = await policy();
  const stamp = crypto.createHash("sha256").update(`${user._id}:${period.from.toISOString()}:${period.to.toISOString()}:${period.period}`).digest("hex");
  return mutate(req, async session => {
    const requestKey = "snapshot_" + stamp;
    const old = await Record.findOne({ createdBy: user._id, requestKey }).session(session);
    if (old) return old;
    const [row] = await Record.create([{ kind: "performance", title: `${period.period} performance snapshot`,
      status: "RECORDED", officerId: user._id, createdBy: user._id, updatedBy: req.user._id,
      requestKey, data: { ...measured, period: period.period, startsAt: period.from.toISOString(),
        endsAt: period.to.toISOString(), methodology: config, capturedAt: new Date().toISOString(),
        capturedBy: String(req.user._id), note: "Immutable historical observation; live outcomes may later change after reversals." } }], { session });
    await audit(req, session, "MARKETING_PERFORMANCE_CAPTURED", row);
    return row;
  });
}
async function reminders(req) {
  const user = await staff(req);
  const today = bounds("DAILY"), targets = await bounded(Record.find({
    kind: "target", officerId: user._id, "data.archivedAt": { $exists: false }, status: "ACTIVE",
    "data.endsAt": { $lte: new Date(Date.now() + 86400000).toISOString() } }), 1000);
  for (const t of targets) {
    const result = await targetResult(t);
    const event = result.outcome === "MISSED" ? "TARGET_MISSED" :
      result.outcome === "COMPLETED" ? "TARGET_COMPLETED" : "TARGET_DEADLINE";
    await mutate(req, session => notify(req, session, user._id, event, t,
      `${t.title}: ${event.replaceAll("_", " ").toLowerCase()}`));
  }
  if (!await Record.exists({ kind: "report", officerId: user._id, "data.period": "DAILY",
    "data.startsAt": { $gte: today.from.toISOString(), $lt: today.to.toISOString() }, status: { $ne: "DRAFT" } })) {
    await mutate(req, session => notify(req, session, user._id, "DAILY_REPORT_REMINDER",
      { _id: user._id }, "Submit your daily marketing activity report.", today.from.toISOString()));
  }
  for (const p of ["WEEKLY", "MONTHLY"]) {
    const current = bounds(p), previous = bounds(p, new Date(+current.from - 1));
    const metrics = await measure(user._id, previous.from, previous.to);
    await mutate(req, session => notify(req, session, user._id, p + "_SUMMARY",
      { _id: user._id }, `${p} summary: ${metrics.verified.ACQUISITIONS} verified acquisitions; ` +
      `${metrics.verified.FIRST_TRANSACTIONS} first transactions. Period ending ${previous.to.toISOString().slice(0, 10)}.`,
      previous.from.toISOString()));
  }
}
let timer, busy = false;
function startNotifications() {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy || mongoose.connection.readyState !== 1) return;
    busy = true;
    try {
      if (!await require("./marketing.service").ready()) return;
      const roles = await require("../models/role.model").find({ department: "MARKETING", status: "ACTIVE",
        name: { $in: ["HEAD_OF_MARKETING", "MARKETING_OFFICER"] } }).select("_id").lean();
      const users = await User.find({ department: "MARKETING", status: "ACTIVE", isStaff: true,
        staffRoleId: { $in: roles.map(r => r._id) } }).select("_id").limit(501).lean();
      if (users.length > 500) throw fail("Notification worker capacity exceeded.");
      for (const user of users) await reminders({ user });
    } catch (error) {
      if (error.code !== 11000) console.warn("[MARKETING] Notification cycle deferred safely.");
    } finally { busy = false; }
  }, 15 * 60 * 1000);
  timer.unref();
}
module.exports = { PERIODS, METRICS, WEIGHTS, POLICY_ID, bounds, dates, policy, notify,
  staff, measure, targetResult, dashboard, department, departmentTargets, snapshot, reminders, startNotifications, bounded };
