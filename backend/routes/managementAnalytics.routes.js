"use strict";
const express = require("express");
const a = require("../services/managementAnalytics.service");
const targets = require("../services/managementTargets.service");
const router = express.Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (!a.ROLES.includes(String(req.user?.role))) return res.status(403).json({ success: false, message: "Assigned management role required." });
  next();
});
const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    const status = Number(e.status) || (e.code === 50 ? 503 : 500);
    res.status(status).json({ success: false, message: status < 500 || e.status === 503 ? e.message : "Reporting is temporarily unavailable. Narrow the filters and retry." });
  }
};
const ok = (res, data) => res.json({ success: true, data });
router.get("/overview", wrap(async (req, res) => ok(res, await a.overview(req.user, req.query))));
router.get("/transactions", wrap(async (req, res) => ok(res, await a.transactionList(req.user, req.query))));
router.get("/transactions/:id", wrap(async (req, res) => ok(res, await a.transactionList(req.user, req.query, req.params.id))));
router.get("/teams", wrap(async (req, res) => ok(res, await a.teams(req.user, req.query))));
router.get("/leaderboard", wrap(async (req, res) => {
  const s = await a.scope(req.user, req.query.teamId), p = a.period(req.query);
  ok(res, await a.leaderboard(s, a.and(s.transactions, a.dateMatch(p)), p, req.query.dimension || "agents", req.query.sort || "transactions"));
}));
router.get("/targets", wrap(async (req, res) => ok(res, await targets.list(req.user, req.query))));
router.post("/targets", wrap(async (req, res) => ok(res, await targets.save(req.user, req.body))));
const HEADINGS = ["Reference", "Customer", "Phone", "Service", "Amount (NGN)", "Status", "Provider", "Date (Africa/Lagos)"];
const csvCell = value => '"' + String(value ?? "").replace(/^[\s]*[=+@\t\r-]/, "'$&").replace(/"/g, '""') + '"';
router.get("/export", wrap(async (req, res) => {
  if (!["csv", "xlsx"].includes(req.query.format)) throw Object.assign(new Error("Choose csv or xlsx."), { status: 400 });
  const s = await a.scope(req.user, req.query.teamId), p = a.period(req.query), match = await a.filters(s, req.query, p);
  // Refuse truncation: exports are exact, bounded snapshots, not sampled lists.
  const rows = await require("../models/transaction.model").find(match)
    .select("reference customerId serviceType amount status provider createdAt").populate("customerId", "fullName phone")
    .sort({ createdAt: -1, _id: -1 }).limit(5001).lean().maxTimeMS(15000);
  if (rows.length > 5000) return res.status(422).json({ success: false, message: "Export exceeds 5,000 rows. Narrow the date or team filter." });
  const data = rows.map(r => a.safeCustomer(r, s)).map(r => [r.reference, r.customerId?.fullName || "Unavailable", r.customerId?.phone || "",
    r.serviceType, r.amount, r.status, r.provider || "", new Date(r.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false })]);
  const format = req.query.format;
  res.attachment("servicepay-team-transactions." + format);
  if (format === "csv") res.type("text/csv").send("\uFEFF" + [HEADINGS, ...data].map(row => row.map(csvCell).join(",")).join("\r\n"));
  else {
    const workbook = new (require("exceljs").Workbook)();
    const sheet = workbook.addWorksheet("Transactions");
    sheet.addRow(HEADINGS);
    data.forEach(row => sheet.addRow(row)); // Strings stay string cells, never formulas.
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach(c => { c.width = 24; });
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }
}));
module.exports = router;
module.exports.csvCell = csvCell;
