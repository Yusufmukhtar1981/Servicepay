"use strict";
const User = require("../models/user.model");
const a = require("./managementAnalytics.service");
const { fail } = require("./managementPeriod.service");
const FIELDS = "_id fullName role status state zone";
const labels = { AGENT: "Aggregator", STATE_MANAGER: "State Manager", ZONAL_MANAGER: "Zonal Manager" };
async function managers(query = {}) {
  const role = String(query.role || "AGENT").toUpperCase();
  if (!a.ROLES.includes(role)) throw fail("Choose Aggregator, State Manager or Zonal Manager.");
  const page = Number(query.page || 1), limit = Number(query.limit || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  const search = String(query.search || "").trim();
  if (search.length > 100) throw fail("Search must be 100 characters or fewer.");
  const filter = { role, isDeleted: { $ne: true } };
  if (search) {
    const regex = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ fullName: regex }, { state: regex }, { zone: regex }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).select(FIELDS).sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit)
      .limit(limit).lean().maxTimeMS(15000),
    User.countDocuments(filter).maxTimeMS(15000),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}
async function report(query = {}) {
  const manager = await User.findOne({
    _id: a.objectId(query.managerId), role: { $in: a.ROLES }, isDeleted: { $ne: true },
  }).select(FIELDS).lean().maxTimeMS(15000);
  if (!manager) throw fail("Management account not found.", 404);
  // No caller-controlled actor, scope override or hierarchy mutation.
  const dates = { period: query.period, from: query.from, to: query.to };
  const scope = await a.scope(manager, undefined, { includeInactiveRoot: true });
  const overview = await a.overview(manager, dates, scope);
  return {
    manager: { ...manager, roleLabel: labels[manager.role] },
    generatedAt: new Date(), overview,
    policy: {
      history: "Captured transactions retain their original manager attribution after reassignment. Legacy visibility is not verified historical custody.",
      commission: "Only this manager's recorded commission is shown; this is not company revenue or a wallet statement.",
      privacy: "This summary contains no customer contacts, account details or credentials. Share only with authorized recipients.",
    },
  };
}
const metrics = [
  ["Total registered customers", "totalCustomers"], ["New customers", "newCustomers"],
  ["Active customers", "activeCustomers"], ["Inactive customers", "inactiveCustomers"],
  ["Registered Aggregators", "totalAgents"], ["Active Aggregators", "activeAgents"],
  ["Inactive Aggregators", "inactiveAgents"], ["Total transactions", "totalTransactions"],
  ["Successful transactions", "successfulTransactions"], ["Failed transactions", "failedTransactions"],
  ["Pending transactions", "pendingTransactions"], ["Refunded transactions", "refundedTransactions"],
  ["Gross transaction value (all statuses, NGN)", "totalValue"], ["Own recorded commission (NGN)", "ownRecordedCommission"],
];
const lagos = d => new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false });
function rows(r) {
  const o = r.overview;
  return [
    ["ServicePay Management Performance Report", ""],
    ["Manager", r.manager.fullName], ["Role", r.manager.roleLabel],
    ["State", r.manager.state || ""], ["Zone", r.manager.zone || ""],
    ["Account status", r.manager.status],
    ["Period starts (Africa/Lagos)", lagos(o.period.from)],
    ["Period ends (inclusive, Africa/Lagos)", lagos(+new Date(o.period.to) - 1)],
    ["Generated (Africa/Lagos)", lagos(r.generatedAt)], [],
    ["Metric", "Actual"], ...metrics.map(([label, key]) => [label, o.kpis[key] || 0]),
    [], ["Weekly bucket starts (Africa/Lagos)", "Transactions", "Successful", "Successful value (NGN)"],
    ...o.weekly.map(p => [lagos(p.at), p.transactions, p.successful, p.successfulValue]),
    [], ["Monthly bucket starts (Africa/Lagos)", "Transactions", "Successful", "Successful value (NGN)"],
    ...o.monthly.map(p => [lagos(p.at), p.transactions, p.successful, p.successfulValue]),
    [], ["Definitions", ""], ...Object.values(o.definitions).map(v => [v]),
    ...Object.values(r.policy).map(v => [v]),
  ];
}
async function exportReport(r, format) {
  if (format === "xlsx") {
    const workbook = new (require("exceljs").Workbook)();
    const sheet = workbook.addWorksheet("Management performance");
    for (const row of rows(r)) sheet.addRow(row); // Strings are not formula objects.
    sheet.columns = [{ width: 64 }, { width: 32 }, { width: 20 }, { width: 28 }];
    sheet.getRow(1).font = { bold: true, size: 15 };
    sheet.views = [{ state: "frozen", ySplit: 11 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  if (format !== "pdf") throw fail("Choose PDF or Excel.");
  return new Promise((resolve, reject) => {
    const doc = new (require("pdfkit"))({ size: "A4", margin: 42,
      info: { Title: "ServicePay Management Performance", Author: "ServicePay" } });
    const buffers = [];
    doc.on("data", b => buffers.push(b)); doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#087A45").text("ServicePay");
    doc.fillColor("#17251e").font("Helvetica").fontSize(10).moveDown();
    for (const row of rows(r)) {
      if (!row.length) doc.moveDown(.6);
      else doc.text(row.map(v => String(v ?? "")).join("  |  "), { lineGap: 4 });
    }
    doc.end();
  });
}
module.exports = { managers, report, exportReport, rows };
