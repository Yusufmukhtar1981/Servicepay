"use strict";
const Target = require("../models/dashboardTarget.model");
const { fail, targetPeriod } = require("./managementPeriod.service");
const analytics = require("./managementAnalytics.service");
const { withParentFence, requireActiveParent, requireActiveLineage } = require("./hierarchyFence.service");
const METRICS = ["newCustomers", "transactions", "activeAgents"];
async function ready() {
  const indexes = await Target.collection.indexes();
  if (!indexes.some(i => i.unique === true && !i.sparse && !i.partialFilterExpression &&
    Object.keys(i.key).length === 1 && i.key.key === 1)) {
    throw fail("Target editing is unavailable until the existing target-key uniqueness safeguard is verified. No index was changed.", 503);
  }
}
function visibleIds(s) {
  if (s.root.role === "AGENT") return [s.root._id];
  return [s.root._id, ...s.ids.agentIds.map(analytics.objectId),
    ...(s.root.role === "ZONAL_MANAGER" ? s.ids.stateManagerIds.map(analytics.objectId) : [])];
}
async function list(actor, query) {
  const s = await analytics.scope(actor, query.teamId), p = analytics.period(query);
  const records = await Target.find({ key: /^hierarchy:/, "management.subjectId": { $in: visibleIds(s) },
    "management.startsAt": { $lt: p.to }, "management.endsAt": { $gt: p.from } })
    .select("key values updatedAt updatedBy management").sort({ "management.startsAt": -1, _id: 1 }).limit(51).lean().maxTimeMS(15000);
  if (records.length > 50) throw fail("Narrow the date or team filter to view at most 50 targets.", 422);
  const results = [];
  // Serial bounded queries avoid flooding the shared production connection pool.
  for (const row of records) {
    const subject = await analytics.scope(actor, row.management.subjectId);
    const dates = { from: new Date(Math.max(+row.management.startsAt, +p.from)),
      to: new Date(Math.min(+row.management.endsAt, +p.to)) };
    const match = analytics.and(subject.transactions, analytics.dateMatch(dates));
    const [newCustomers, transactions, agents] = await Promise.all([
      require("../models/user.model").countDocuments(analytics.and(subject.customers, analytics.dateMatch(dates))).maxTimeMS(15000),
      require("../models/transaction.model").countDocuments(match).maxTimeMS(15000),
      analytics.opts(require("../models/transaction.model").aggregate([{ $match: analytics.and(match, analytics.successful,
        { hierarchyCapturedAt: { $type: "date" }, agentId: { $in: subject.root.role === "AGENT" ? [subject.root._id] : subject.ids.agentIds.map(analytics.objectId) } }) },
      { $group: { _id: "$agentId" } }, { $count: "count" }])),
    ]);
    const actual = { newCustomers, transactions, activeAgents: agents[0]?.count || 0 };
    const values = row.values instanceof Map ? Object.fromEntries(row.values) : row.values;
    const progress = Object.fromEntries(Object.entries(values).map(([metric, target]) => [metric,
      { target, actual: actual[metric], percent: actual[metric] / target * 100 }]));
    results.push({ ...row, subjectName: subject.root.fullName, progress, measurementPeriod: dates });
  }
  return { items: results, canManage: ["ZONAL_MANAGER", "STATE_MANAGER"].includes(s.actor.role), metrics: METRICS };
}
async function save(actor, body) {
  const s = await analytics.scope(actor, body.subjectId);
  if (!["ZONAL_MANAGER", "STATE_MANAGER"].includes(s.actor.role)) throw fail("Only assigned State and Zonal Managers may set targets.", 403);
  const dates = targetPeriod(body);
  const values = body.values;
  if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length ||
    Object.entries(values).some(([k, v]) => !METRICS.includes(k) || !Number.isSafeInteger(v) || v <= 0 || v > 1000000000)) throw fail("Provide positive whole-number targets for supported metrics.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.reason !== "string" ||
    !body.reason.trim() || body.reason.length > 500) throw fail("Provide the current revision and a reason of 1–500 characters.");
  if (dates.to <= new Date()) throw fail("Completed target periods cannot be changed.", 409);
  await ready();
  const startDate = new Date(+dates.from + 3600000).toISOString().slice(0, 10);
  const key = `hierarchy:${s.root._id}:${body.period}:${startDate}`;
  let result;
  try {
    await withParentFence(s.actor._id, s.actor.role, async (actor, lineage, session) => {
      if (String(s.root._id) !== String(actor._id)) {
        const subject = await requireActiveParent(s.root._id, s.root.role, session);
        const currentLineage = await requireActiveLineage(subject, session);
        if (actor.role === "ZONAL_MANAGER" ? String(currentLineage.zonalManagerId) !== String(actor._id) :
          subject.role !== "AGENT" || String(currentLineage.stateManagerId) !== String(actor._id)) {
          throw fail("Team assignment changed. Refresh before editing.", 409);
        }
      }
      const existing = await Target.findOne({ key }).session(session).lean();
      if ((existing?.management?.revision ?? 0) !== body.revision) throw fail("Target changed. Refresh and retry.", 409);
      if ((existing?.management?.history?.length || 0) >= 250) throw fail("Target audit history limit reached.", 409);
      const event = { actor: s.actor._id, at: new Date(), reason: body.reason.trim(), values };
      if (!existing) {
        const [row] = await Target.create([{ key, values, updatedBy: s.actor._id, management: { subjectId: s.root._id,
          period: body.period, startsAt: dates.from, endsAt: dates.to, revision: 1, history: [event] } }], { session });
        result = { id: row._id, revision: 1 };
      } else {
        const row = await Target.findOneAndUpdate({ _id: existing._id, key, "management.revision": body.revision },
          { $set: { values, updatedBy: s.actor._id }, $inc: { "management.revision": 1 }, $push: { "management.history": event } },
          { new: true, runValidators: true, session }).select("_id management.revision").lean();
        if (!row) throw fail("Target changed. Refresh and retry.", 409);
        result = { id: row._id, revision: row.management.revision };
      }
    });
  } catch (e) {
    if (e.code === 11000) throw fail("Target already exists. Refresh before editing.", 409);
    throw e;
  }
  return result;
}
module.exports = { list, save, ready, METRICS };
