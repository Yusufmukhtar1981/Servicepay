"use strict";
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const { getZonalScope } = require("./zonalScope.service");
const { period, fail, DAY } = require("./managementPeriod.service");
const ROLES = ["AGENT", "STATE_MANAGER", "ZONAL_MANAGER"];
const FIELDS = "reference customerId agentId stateManagerId zonalManagerId hierarchyCapturedAt serviceType amount status provider createdAt updatedAt description";
const objectId = value => {
  if (!/^[a-f0-9]{24}$/i.test(String(value || ""))) throw fail("Invalid identifier.");
  return new mongoose.Types.ObjectId(String(value));
};
const and = (...parts) => ({ $and: parts.filter(Boolean) });
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dateMatch = p => ({ createdAt: { $gte: p.from, $lt: p.to } });
function safeCustomer(row, s) {
  if (row.customerId?._id && !s.ids.customerIds.includes(String(row.customerId._id))) {
    // Historical transaction custody does not grant access to a customer's
    // new contact information after that customer changes reporting lines.
    row.customerId = { _id: row.customerId._id, fullName: "Historical customer", phone: "" };
  }
  return row;
}
const successful = { status: "SUCCESSFUL", reversalReference: { $in: ["", null] }, reversalTransactionId: null };
const opts = query => query.option({ maxTimeMS: 15000, allowDiskUse: false });
async function scope(actor, teamId) {
  const current = await User.findOne({ _id: objectId(actor?._id || actor?.id), status: "ACTIVE", isDeleted: { $ne: true } })
    .select("_id fullName role zone state zonalManagerId stateManagerId agentId").lean();
  if (!current || !ROLES.includes(current.role)) throw fail("This workspace is restricted to assigned managers and Aggregators.", 403);
  let root = current;
  let ids = await getZonalScope(current);
  const descendants = current.role === "ZONAL_MANAGER" ? [...ids.stateManagerIds, ...ids.agentIds]
    : current.role === "STATE_MANAGER" ? ids.agentIds : [];
  if (teamId && String(teamId) !== String(current._id)) {
    if (!descendants.includes(String(teamId))) throw fail("Team is outside your authorized hierarchy.", 404);
    root = await User.findOne({ _id: objectId(teamId), isDeleted: { $ne: true }, role: { $in: ROLES } })
      .select("_id fullName role zone state zonalManagerId stateManagerId").lean();
    if (!root) throw fail("Team not found.", 404);
    // Parent scope already verifies even suspended descendants. Do not lose
    // historical oversight merely because the selected team is inactive.
    const agents = root.role === "STATE_MANAGER" ? await User.find({
      _id: { $in: ids.agentIds.map(objectId) }, stateManagerId: root._id,
    }).select("_id").lean() : [{ _id: root._id }];
    const agentsInTeam = agents.map(u => u._id);
    const customers = await User.find(and({ _id: { $in: ids.customerIds.map(objectId) } },
      root.role === "STATE_MANAGER" ? { $or: [{ stateManagerId: root._id }, { agentId: { $in: agentsInTeam } }] } : { agentId: root._id }))
      .select("_id").lean();
    ids = { stateManagerIds: root.role === "STATE_MANAGER" ? [String(root._id)] : [],
      agentIds: agentsInTeam.map(String), customerIds: customers.map(u => String(u._id)) };
  }
  const customerIds = ids.customerIds.map(objectId);
  const lineage = { AGENT: "agentId", STATE_MANAGER: "stateManagerId", ZONAL_MANAGER: "zonalManagerId" }[root.role];
  // Current customer assignment is an explicitly labelled legacy visibility
  // fallback, never evidence of historical financial custody.
  const transactions = { $or: [
    { [lineage]: root._id, hierarchyCapturedAt: { $type: "date" } },
    { hierarchyCapturedAt: null, customerId: { $in: customerIds } },
  ] };
  return { actor: current, root, ids, customerIds, transactions,
    customers: { _id: { $in: customerIds }, role: "CUSTOMER", isDeleted: { $ne: true } } };
}
async function filters(s, query, p) {
  const conditions = [s.transactions, dateMatch(p)];
  const status = String(query.status || "ALL").toUpperCase();
  const service = String(query.serviceType || "ALL").toUpperCase();
  if (!["ALL", "SUCCESSFUL", "FAILED", "PENDING", "REFUNDED"].includes(status)) throw fail("Unsupported transaction status.");
  if (status !== "ALL") conditions.push({ status });
  if (service !== "ALL") {
    if (!/^[A-Z0-9_]{1,50}$/.test(service)) throw fail("Invalid service filter.");
    conditions.push({ serviceType: service });
  }
  const search = String(query.search || "").trim();
  if (search.length > 100) throw fail("Search must be 100 characters or fewer.");
  if (search) {
    const regex = { $regex: escape(search), $options: "i" };
    const users = await User.find(and(s.customers, { $or: [{ fullName: regex }, { phone: regex }] })).select("_id").limit(1001).lean();
    if (users.length > 1000) throw fail("Narrow the customer search.", 422);
    conditions.push({ $or: [{ reference: regex }, { customerId: { $in: users.map(u => u._id) } }] });
  }
  return and(...conditions);
}
function pagination(query) {
  const page = Number(query.page || 1), limit = Number(query.limit || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  return { page, limit };
}
async function transactionList(actor, query = {}, transactionId) {
  const s = await scope(actor, query.teamId);
  if (transactionId) {
    const row = await Transaction.findOne(and(s.transactions, { _id: objectId(transactionId) }))
      .select(FIELDS).populate("customerId", "fullName phone").lean().maxTimeMS(15000);
    if (!row) throw fail("Transaction not found in your scope.", 404);
    return { transaction: safeCustomer(row, s) };
  }
  const p = period(query), match = await filters(s, query, p), { page, limit } = pagination(query);
  const [items, total] = await Promise.all([
    Transaction.find(match).select(FIELDS).populate("customerId", "fullName phone")
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().maxTimeMS(15000),
    Transaction.countDocuments(match).maxTimeMS(15000),
  ]);
  return { items: items.map(r => safeCustomer(r, s)), total, page, limit, totalPages: Math.ceil(total / limit), period: p };
}
async function totals(match, customerMatch, p) {
  const [rows, acquired, registered] = await Promise.all([
    opts(Transaction.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }])),
    User.countDocuments(and(customerMatch, dateMatch(p))).maxTimeMS(15000),
    User.countDocuments(customerMatch).maxTimeMS(15000),
  ]);
  const result = { totalCustomers: registered, newCustomers: acquired, activeCustomers: 0,
    totalTransactions: 0, totalValue: 0, successfulTransactions: 0, failedTransactions: 0, pendingTransactions: 0, refundedTransactions: 0 };
  const names = { SUCCESSFUL: "successfulTransactions", FAILED: "failedTransactions", PENDING: "pendingTransactions", REFUNDED: "refundedTransactions" };
  for (const row of rows) { result.totalTransactions += row.count; result.totalValue += row.amount; if (names[row._id]) result[names[row._id]] += row.count; }
  // A captured historical customer may have since moved out of this team.
  // Keep financial totals intact; compute *current* active/inactive separately.
  const currentActive = await opts(Transaction.aggregate([{ $match: and(match, successful, { customerId: customerMatch._id }) },
    { $group: { _id: "$customerId" } }, { $count: "count" }]));
  result.activeCustomers = currentActive[0]?.count || 0;
  result.inactiveCustomers = Math.max(0, registered - result.activeCustomers);
  return result;
}
async function series(match, unit) {
  return opts(Transaction.aggregate([{ $match: match }, { $group: {
    _id: { $dateTrunc: { date: "$createdAt", unit, timezone: "Africa/Lagos", ...(unit === "week" ? { startOfWeek: "monday" } : {}) } },
    transactions: { $sum: 1 }, successful: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, 1, 0] } },
    successfulValue: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, "$amount", 0] } },
  } }, { $sort: { _id: 1 } }, { $project: { _id: 0, at: "$_id", transactions: 1, successful: 1, successfulValue: 1 } }]));
}
async function leaderboard(s, match, p, dimension, sort) {
  const groups = {
    agents: { field: "agentId", ids: s.root.role === "AGENT" ? [s.root._id] : s.ids.agentIds.map(objectId) },
    states: { field: "stateManagerId", ids: s.root.role === "STATE_MANAGER" ? [s.root._id] : s.root.role === "ZONAL_MANAGER" ? s.ids.stateManagerIds.map(objectId) : [] },
    zones: { field: "zonalManagerId", ids: s.root.role === "ZONAL_MANAGER" ? [s.root._id] : [] },
  };
  if (!groups[dimension]) throw fail("Choose agents, states or zones.");
  const g = groups[dimension];
  if (!["transactions", "successfulValue", "newCustomers"].includes(sort)) throw fail("Unknown ranking metric.");
  const users = await User.find({ _id: { $in: g.ids }, isDeleted: { $ne: true } }).select("_id fullName role state zone status").lean().maxTimeMS(15000);
  if (users.length > 2000) throw fail("Narrow the team selection.", 422);
  const [txs, acquired] = await Promise.all([
    opts(Transaction.aggregate([{ $match: and(match, { hierarchyCapturedAt: { $type: "date" }, [g.field]: { $in: g.ids } }) },
      { $group: { _id: "$" + g.field, transactions: { $sum: 1 },
        successfulValue: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "SUCCESSFUL"] },
          { $in: [{ $ifNull: ["$reversalReference", ""] }, [""]] }, { $eq: [{ $ifNull: ["$reversalTransactionId", null] }, null] }] }, "$amount", 0] } } } }])),
    opts(User.aggregate([{ $match: and(s.customers, dateMatch(p), { [g.field]: { $in: g.ids } }) }, { $group: { _id: "$" + g.field, newCustomers: { $sum: 1 } } }])),
  ]);
  const tm = new Map(txs.map(r => [String(r._id), r])), cm = new Map(acquired.map(r => [String(r._id), r.newCustomers]));
  let rows = users.map(u => ({ id: String(u._id), name: u.fullName, role: u.role, state: u.state, zone: u.zone,
    accountStatus: u.status, transactions: tm.get(String(u._id))?.transactions || 0,
    successfulValue: tm.get(String(u._id))?.successfulValue || 0, newCustomers: cm.get(String(u._id)) || 0,
    achievementPercent: null }));
  const metric = sort === "newCustomers" ? "newCustomers" : sort === "transactions" ? "transactions" : null;
  let assigned = new Map();
  if (metric && users.length) {
    const targets = await require("../models/dashboardTarget.model").find({ key: /^hierarchy:/,
      "management.subjectId": { $in: users.map(u => u._id) }, "management.startsAt": p.from, "management.endsAt": p.to })
      .select("values management.subjectId").lean().maxTimeMS(15000);
    assigned = new Map(targets.map(t => [String(t.management.subjectId), t.values?.[metric]]));
    rows.forEach(r => { const value = assigned.get(r.id); if (Number(value) > 0) r.achievementPercent = r[sort] / value * 100; });
  }
  if (dimension === "states") {
    const states = new Map();
    for (const r of rows) {
      const state = String(r.state || "").trim();
      if (!state) continue; // Unknown geography is not an invented state.
      const row = states.get(state) || { id: "state:" + state, name: state, state, zone: r.zone, role: "STATE",
        transactions: 0, successfulValue: 0, newCustomers: 0, achievementPercent: null, assigned: 0, members: 0, target: 0 };
      row.transactions += r.transactions; row.successfulValue += r.successfulValue; row.newCustomers += r.newCustomers;
      row.members++;
      if (Number(assigned.get(r.id)) > 0) { row.assigned++; row.target += Number(assigned.get(r.id)); }
      states.set(state, row);
    }
    rows = [...states.values()].map(({ assigned: n, members, target, ...r }) =>
      ({ ...r, achievementPercent: metric && n === members && target > 0 ? r[sort] / target * 100 : null }));
  }
  rows.sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: rows.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 })), total: rows.length,
    methodology: "Transaction rankings use captured historical hierarchy only. Acquisition uses current verified assignment. Achievement is unavailable without an assigned target." };
}
async function overview(actor, query = {}) {
  const s = await scope(actor, query.teamId), p = period(query);
  const match = and(s.transactions, dateMatch(p));
  const previousMatch = and(s.transactions, dateMatch(p.previous));
  const agentIds = s.root.role === "AGENT" ? [s.root._id] : s.ids.agentIds.map(objectId);
  const [kpis, previous, weekly, monthly, agents, activeAgents, commission, legacy] = await Promise.all([
    totals(match, s.customers, p), totals(previousMatch, s.customers, p.previous),
    series(match, "week"), series(match, "month"),
    User.countDocuments({ _id: { $in: agentIds }, role: "AGENT", isDeleted: { $ne: true } }).maxTimeMS(15000),
    opts(Transaction.aggregate([{ $match: and(match, successful, { hierarchyCapturedAt: { $type: "date" }, agentId: { $in: agentIds } }) }, { $group: { _id: "$agentId" } }, { $count: "count" }])),
    opts(Commission.aggregate([{ $match: { beneficiaryId: s.actor._id, status: { $in: ["AVAILABLE", "WITHDRAWN"] }, ...dateMatch(p) } },
      { $lookup: { from: Transaction.collection.name, localField: "transactionId", foreignField: "_id",
        pipeline: [{ $match: s.transactions }, { $project: { _id: 1 } }], as: "authorizedTransaction" } },
      { $match: { "authorizedTransaction.0": { $exists: true } } },
      { $group: { _id: null, amount: { $sum: "$commissionAmount" } } }])),
    Transaction.countDocuments(and(match, { hierarchyCapturedAt: null })).maxTimeMS(15000),
  ]);
  return { period: p, scope: { id: s.root._id, name: s.root.fullName, role: s.root.role, state: s.root.state, zone: s.root.zone },
    canManageTargets: ["ZONAL_MANAGER", "STATE_MANAGER"].includes(s.actor.role),
    kpis: { ...kpis, totalAgents: agents, activeAgents: activeAgents[0]?.count || 0,
      inactiveAgents: Math.max(0, agents - (activeAgents[0]?.count || 0)), ownRecordedCommission: commission[0]?.amount || 0 },
    previous, weekly, monthly, legacyTransactions: legacy,
    definitions: { active: "At least one successful transaction in the selected period; this is not login activity.",
      commission: "Only your own recorded AVAILABLE/WITHDRAWN commission entries; not company revenue.",
      legacy: "Legacy transactions use existing customer-scoped visibility and are excluded from historical team rankings.",
      comparison: "Previous adjacent period of equal duration, in Africa/Lagos." } };
}
async function teams(actor, query = {}) {
  const s = await scope(actor, query.teamId);
  const ids = s.root.role === "ZONAL_MANAGER" ? [...s.ids.stateManagerIds, ...s.ids.agentIds] : s.root.role === "STATE_MANAGER" ? s.ids.agentIds : [];
  const { page, limit } = pagination(query);
  const search = String(query.search || "").trim();
  if (search.length > 100) throw fail("Search is too long.");
  const match = { _id: { $in: ids.map(objectId) }, isDeleted: { $ne: true }, ...(search ? { fullName: { $regex: escape(search), $options: "i" } } : {}) };
  const [items, total] = await Promise.all([
    User.find(match).select("_id fullName role state zone status createdAt").sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean().maxTimeMS(15000),
    User.countDocuments(match).maxTimeMS(15000),
  ]);
  const p = period(query), performanceMatch = and(s.transactions, dateMatch(p), { hierarchyCapturedAt: { $type: "date" } });
  for (const [role, field] of [["AGENT", "agentId"], ["STATE_MANAGER", "stateManagerId"]]) {
    const teamIds = items.filter(u => u.role === role).map(u => u._id);
    if (!teamIds.length) continue;
    const stats = await opts(Transaction.aggregate([{ $match: and(performanceMatch, { [field]: { $in: teamIds } }) },
      { $group: { _id: "$" + field, transactions: { $sum: 1 }, successful: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, 1, 0] } },
        lastTransactionAt: { $max: "$createdAt" } } }]));
    const byId = new Map(stats.map(r => [String(r._id), r]));
    items.filter(u => u.role === role).forEach(u => { const v = byId.get(String(u._id)); u.performance = {
      transactions: v?.transactions || 0, successful: v?.successful || 0,
      activeInPeriod: (v?.successful || 0) > 0, lastTransactionAt: v?.lastTransactionAt || null }; });
  }
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}
module.exports = { ROLES, scope, filters, transactionList, overview, leaderboard, teams, period, and, objectId, dateMatch, totals, opts, successful, safeCustomer, DAY };
