"use strict";
const M = require("../models/profitSharing.models");
const Transaction = require("../models/transaction.model");
const custody = require("./profitSharing.custody");
const roles = ["HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER", "AGGREGATOR"];
const fail = (code, statusCode = 400) => { throw Object.assign(Error(code), { code, statusCode }); };
function pagination(query) {
  const page = Number(query.page || 1), limit = Number(query.limit || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("INVALID_PAGINATION");
  return { page, limit };
}
const exact = value => {
  if (!Number.isSafeInteger(value) || value < 0) fail("COMMISSION_JOURNAL_RECONCILIATION_REQUIRED", 503);
  return value;
};
const add = (a, b) => {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail("COMMISSION_REPORT_PRECISION_OVERFLOW", 503);
  return result;
};
async function history(query = {}, accountId) {
  const { page, limit } = pagination(query), to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 93 * 86400000) {
    fail("SELECT_A_VALID_REPORT_PERIOD_UP_TO_93_DAYS");
  }
  const filter = { kind: { $in: ["ACCRUAL", "REVERSAL", "BLOCKED"] }, createdAt: { $gte: from, $lt: to } };
  if (accountId) filter["data.entries.accountId"] = accountId;
  const rows = await M.Event.find(filter).sort({ createdAt: -1, _id: -1 }).limit(10001).lean().maxTimeMS(5000);
  if (rows.length > 10000) fail("NARROW_THE_COMMISSION_REPORT_PERIOD", 422);
  const allocations = Object.fromEntries(roles.map(role => [role, {
    role, creditedKobo: 0, reversedKobo: 0, netKobo: 0, heldKobo: 0,
  }]));
  const summary = { companyProfitKobo: 0, creditedKobo: 0, reversedKobo: 0, netAllocatedKobo: 0, heldKobo: 0 };
  const allItems = rows.map(row => {
    const blocked = row.kind === "BLOCKED", reversed = row.kind === "REVERSAL";
    const entries = blocked ? [] : row.data.entries.filter(entry => !accountId || entry.accountId === accountId);
    let amountKobo = blocked ? null : 0, credited = 0;
    for (const entry of entries) {
      exact(entry.amountKobo);
      amountKobo = add(amountKobo, entry.amountKobo);
      const assigned = entry.role === "HEAD_OFFICE" ? entry.accountId === "head-office" :
        roles.includes(entry.role) && /^beneficiary:[a-f\d]{24}$/i.test(entry.accountId);
      if (!assigned) summary.heldKobo = add(summary.heldKobo, reversed ? -entry.amountKobo : entry.amountKobo);
      else credited = add(credited, entry.amountKobo);
      if (allocations[entry.role]) {
        const field = !assigned ? "heldKobo" : reversed ? "reversedKobo" : "creditedKobo";
        allocations[entry.role][field] = add(allocations[entry.role][field],
          !assigned && reversed ? -entry.amountKobo : entry.amountKobo);
      }
    }
    if (!blocked) {
      const field = reversed ? "reversedKobo" : "creditedKobo";
      summary[field] = add(summary[field], credited);
      const profit = reversed ? -amountKobo : exact(row.data.plan.netProfitKobo);
      if (!accountId) summary.companyProfitKobo = add(summary.companyProfitKobo, profit);
    }
    return { id: row._id, kind: row.kind, transactionId: row.transaction && String(row.transaction),
      createdAt: row.createdAt, amountKobo, entries,
      companyProfitKobo: !accountId && !blocked && !reversed ? row.data.plan.netProfitKobo : null,
      code: blocked ? row.data.code : null };
  });
  summary.netAllocatedKobo = add(summary.creditedKobo, -summary.reversedKobo);
  summary.allocations = Object.values(allocations).map(row => ({
    ...row, netKobo: add(row.creditedKobo, -row.reversedKobo),
  }));
  const selected = allItems.slice((page - 1) * limit, page * limit);
  const transactions = await Transaction.find({ _id: { $in: selected.map(row => row.transactionId).filter(Boolean) } })
    .select("_id reference serviceType").lean().maxTimeMS(5000);
  const byId = new Map(transactions.map(row => [String(row._id), row]));
  return { summary, items: selected.map(({ transactionId, ...row }) => ({
    ...row, transactionId, reference: byId.get(transactionId)?.reference || "",
    serviceType: byId.get(transactionId)?.serviceType || "",
  })), page, limit, total: rows.length, from: from.toISOString(), to: to.toISOString(),
  source: "FUTURE_PROFIT_SHARING_ONLY" };
}
async function headOffice(query) {
  const result = await history(query);
  return { ...result, companyAccount: (await custody.backedAccount("head-office", null)).value };
}
async function own(actor, query) {
  if (!custody.roles.includes(actor?.role)) fail("ACTIVE_MANAGEMENT_BENEFICIARY_REQUIRED", 403);
  const accountId = `beneficiary:${actor._id}`;
  const result = await history(query, accountId);
  const { companyProfitKobo, allocations, ...summary } = result.summary;
  return { ...result, summary, account: (await custody.backedAccount(accountId, null)).value };
}
module.exports = { history, headOffice, own, pagination };
