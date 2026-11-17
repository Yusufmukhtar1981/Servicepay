"use strict";
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const Withdrawal = require("../models/withdrawalRequest.model");
const Case = require("../models/fintechCase.model");
const Audit = require("../models/adminAuditLog.model");
const a = require("./managementAnalytics.service");
const policy = require("./managementWorkspacePolicy.service");
const { fail, registration, WITHDRAWAL_BLOCKER } = policy;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CLOSED = ["RESOLVED", "REJECTED", "CLOSED"];
const id = value => a.objectId(value);
const select = "_id fullName phone email status createdAt";
const date = value => value ? new Date(value) : null;
function pagination(query = {}) {
  const page = Number(query.page || 1), limit = Number(query.limit || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  return { page, limit };
}
const pageOf = (items, query) => {
  const { page, limit } = pagination(query);
  return { items: items.slice((page - 1) * limit, page * limit), page, limit, total: items.length, totalPages: Math.ceil(items.length / limit) };
};
const matchTransactions = s => a.and(s.transactions, { hierarchyCapturedAt: { $type: "date" } });
const measure = match => Transaction.aggregate([{ $match: match }, { $group: {
  _id: "$customerId", transactions: { $sum: 1 },
  transactionVolume: { $sum: { $cond: [{ $and: [
    { $eq: ["$status", "SUCCESSFUL"] }, { $eq: [{ $ifNull: ["$reversalTransactionId", null] }, null] },
    { $eq: [{ $ifNull: ["$reversalReference", ""] }, ""] },
  ] }, "$amount", 0] } },
  lastTransactionAt: { $max: "$createdAt" },
  lastSuccessfulAt: { $max: { $cond: [{ $and: [
    { $eq: ["$status", "SUCCESSFUL"] }, { $eq: [{ $ifNull: ["$reversalTransactionId", null] }, null] },
    { $eq: [{ $ifNull: ["$reversalReference", ""] }, ""] },
  ] }, "$createdAt", null] } },
} }]).option({ maxTimeMS: 15000, allowDiskUse: false });
async function customerRows(s, query = {}) {
  const search = query.search === undefined ? "" : policy.text(query.search, 100);
  const activity = String(query.activity || "ALL");
  if (!["ALL", "ACTIVE", "DECLINING", "INACTIVE", "NEW"].includes(activity)) throw fail("Invalid customer activity filter.");
  // Bound complete result processing; refuse rather than silently truncating.
  const users = await User.find(a.and(s.customers, registration(query), search ? { $or: [
    { fullName: { $regex: escape(search), $options: "i" } },
    { phone: { $regex: escape(search), $options: "i" } },
    { email: { $regex: escape(search), $options: "i" } },
  ] } : null)).select(select).sort({ createdAt: -1, _id: -1 }).limit(10001).lean().maxTimeMS(15000);
  if (users.length > 10000) throw fail("Narrow the customer search or registration dates; this view supports 10,000 customers per filter.", 422);
  const stats = users.length ? await measure(a.and(matchTransactions(s), { customerId: { $in: users.map(u => u._id) } })) : [];
  const byId = new Map(stats.map(row => [String(row._id), row]));
  const now = new Date();
  return users.map(u => {
    const row = byId.get(String(u._id));
    return { id: String(u._id), fullName: u.fullName, phone: u.phone, email: u.email || "", createdAt: u.createdAt,
      accountStatus: u.status, activityStatus: policy.activity(row?.lastSuccessfulAt, u.createdAt, u.status, now),
      transactions: row?.transactions || 0, transactionVolume: row?.transactionVolume || 0,
      lastTransactionAt: row?.lastTransactionAt || null };
  }).filter(u => activity === "ALL" || u.activityStatus === activity);
}
async function customerList(actor, query = {}) {
  pagination(query);
  const s = await a.scope(actor, query.teamId);
  return { ...pageOf(await customerRows(s, query), query), canViewWallet: false, legacyTransactionsExcluded: true,
    activityBasis: "Successful, unreversed transactions with captured authorized hierarchy; registration date is used when no such transaction exists." };
}
async function customerTransactions(actor, customerId, query = {}) {
  const s = await a.scope(actor, query.teamId), customer = await User.findOne(a.and(s.customers, { _id: id(customerId) })).select(select).lean().maxTimeMS(15000);
  if (!customer) throw fail("Customer not found in your hierarchy.", 404);
  const { page, limit } = pagination(query);
  const search = query.search === undefined ? "" : policy.text(query.search, 100);
  const match = a.and(matchTransactions(s), { customerId: customer._id },
    search ? { reference: { $regex: escape(search), $options: "i" } } : null);
  const [items, total] = await Promise.all([
    Transaction.find(match).select("_id reference serviceType amount status createdAt").sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit).lean().maxTimeMS(15000),
    Transaction.countDocuments(match).maxTimeMS(15000),
  ]);
  return { items: items.map(({ _id, ...r }) => ({ id: String(_id), ...r })), total, page, limit, totalPages: Math.ceil(total / limit), legacyTransactionsExcluded: true };
}
async function customerDetail(actor, customerId, query = {}) {
  const s = await a.scope(actor, query.teamId);
  if (!s.ids.customerIds.includes(String(customerId))) throw fail("Customer not found in your hierarchy.", 404);
  const rows = await customerRows({ ...s, customers: a.and(s.customers, { _id: id(customerId) }) });
  if (!rows.length) throw fail("Customer not found.", 404);
  return { customer: rows[0], transactions: await customerTransactions(actor, customerId, query), legacyTransactionsExcluded: true, canViewWallet: false };
}
async function withdrawalSummary(actor) {
  const s = await a.scope(actor);
  const records = await Commission.aggregate([{ $match: { beneficiaryId: s.actor._id, beneficiaryRole: s.actor.role } },
    { $group: { _id: "$status", amount: { $sum: "$commissionAmount" } } }]).option({ maxTimeMS: 15000, allowDiskUse: false });
  const amount = status => records.find(r => r._id === status)?.amount || 0;
  return {
    totalCommissionEarned: amount("AVAILABLE") + amount("WITHDRAWN"),
    recordedAvailableCommission: amount("AVAILABLE"), recordedWithdrawnCommission: amount("WITHDRAWN"),
    availableCommission: null, totalWithdrawn: null, pendingWithdrawals: null,
  };
}
async function withdrawals(actor, query = {}) {
  const s = await a.scope(actor), { page, limit } = pagination(query);
  const filter = { user: s.actor._id };
  const [summary, legacy, total] = await Promise.all([
    withdrawalSummary(actor), Withdrawal.find(filter).select("_id reference amount status createdAt adminNote payoutReference")
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().maxTimeMS(15000),
    Withdrawal.countDocuments(filter).maxTimeMS(15000),
  ]);
  return { summary, readiness: WITHDRAWAL_BLOCKER, items: [], legacyWalletWithdrawals: legacy.map(({ _id, ...r }) => ({
    id: String(_id), ...r, source: "LEGACY_MAIN_WALLET",
  })), page, limit, total, totalPages: Math.ceil(total / limit) };
}
async function overview(actor, query = {}) {
  const s = await a.scope(actor, query.teamId);
  const [base, customers, commission, open] = await Promise.all([
    a.overview(actor, query, s), customerRows(s), withdrawalSummary(actor),
    Case.countDocuments({ type: "COMPLAINT", createdBy: s.actor._id, managementIssueCategory: { $exists: true },
      customer: { $in: s.customerIds }, status: { $nin: CLOSED } }).maxTimeMS(15000),
  ]);
  const counts = Object.fromEntries(["ACTIVE", "DECLINING", "INACTIVE", "NEW", "UNKNOWN"].map(v => [v, customers.filter(u => u.activityStatus === v).length]));
  const within = preset => {
    const p = a.period({ period: preset });
    return customers.filter(c => date(c.createdAt) >= p.from && date(c.createdAt) < p.to).length;
  };
  return { ...base, kpis: { ...base.kpis, activeCustomers: counts.ACTIVE, inactiveCustomers: counts.INACTIVE,
    decliningCustomers: counts.DECLINING, newCustomersWithoutTransactions: counts.NEW, unclassifiedCustomers: counts.UNKNOWN,
    newCustomersToday: within("TODAY"), newCustomersThisWeek: within("THIS_WEEK"), newCustomersThisMonth: within("THIS_MONTH"),
    totalCommissionEarned: commission.totalCommissionEarned, availableCommission: null, pendingWithdrawals: null, openCustomerComplaints: open },
    withdrawalReadiness: WITHDRAWAL_BLOCKER,
    definitions: { ...base.definitions, active: "Successful activity within 30 days; declining at 31 through 60 complete days; inactive after 60 days. Account restrictions are a separate status. Registration date is used when captured successful activity is absent; newly registered customers remain NEW for 30 days.",
      commission: "Recorded earnings only. Available commission custody and past payout allocation are not yet verified; null does not mean zero." } };
}
async function performance(actor, query = {}) {
  const s = await a.scope(actor, query.teamId), p = a.period(query);
  const sort = query.sort || "transactions";
  if (!["transactions", "transactionVolume", "lastTransactionAt"].includes(sort)) throw fail("Invalid customer ranking.");
  const customers = await customerRows(s), byId = new Map(customers.map(c => [c.id, c]));
  const stats = await measure(a.and(matchTransactions(s), a.dateMatch(p), { customerId: { $in: s.customerIds } }));
  const items = stats.filter(r => byId.has(String(r._id))).map(r => ({ ...byId.get(String(r._id)),
    transactions: r.transactions, transactionVolume: r.transactionVolume, lastTransactionAt: r.lastTransactionAt }));
  items.sort((x, y) => (sort === "lastTransactionAt" ? +date(y[sort]) - +date(x[sort]) : y[sort] - x[sort]) || x.id.localeCompare(y.id));
  return { items: items.slice(0, 25), stopped: customers.filter(c => c.transactions > 0 && ["DECLINING", "INACTIVE"].includes(c.activityStatus)).slice(0, 50), period: p };
}
async function exportCustomers(actor, query) {
  if (!["csv", "xlsx"].includes(query.format)) throw fail("Choose csv or xlsx.");
  const s = await a.scope(actor, query.teamId), rows = await customerRows(s, query);
  if (rows.length > 5000) throw fail("Narrow the filters to at most 5,000 customers.", 422);
  await Audit.create({ actorId: s.actor._id, actorRole: s.actor.role, action: "MANAGEMENT_CUSTOMERS_EXPORTED",
    reason: "Exported authorized management customer contacts.", metadata: { report: "MANAGEMENT_CUSTOMER_CONTACTS", rowCount: rows.length, format: query.format } });
  return rows.map(r => [r.fullName, r.phone, r.email]);
}
module.exports = { customerList, customerDetail, customerTransactions, customerRows, overview, performance, withdrawals, withdrawalSummary, exportCustomers, pagination, pageOf, CLOSED, matchTransactions };
