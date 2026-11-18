"use strict";
const express = require("express");
const workspace = require("../services/managementWorkspace.service");
const complaints = require("../services/managementComplaints.service");
const analytics = require("../services/managementAnalytics.service");
const { fail, WITHDRAWAL_BLOCKER } = require("../services/managementWorkspacePolicy.service");
const router = express.Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (!analytics.ROLES.includes(req.user?.role)) return res.status(403).json({ success: false, message: "An assigned management role is required." });
  next();
});
const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    const status = e.status || (e.code === 50 ? 503 : 500);
    res.status(status).json({ success: false, ...(typeof e.code === "string" ? { code: e.code } : {}),
      message: status < 500 || e.status === 503 ? e.message : "Management workspace is temporarily unavailable. Please retry." });
  }
};
const ok = (res, data) => res.json({ success: true, data });
router.get("/overview", wrap(async (req, res) => ok(res, await workspace.overview(req.user, req.query))));
router.get("/performance", wrap(async (req, res) => ok(res, await workspace.performance(req.user, req.query))));
router.get("/customers", wrap(async (req, res) => ok(res, await workspace.customerList(req.user, req.query))));
const csvCell = value => `"${String(value ?? "").replace(/^[\s]*[=+@\t\r-]/, "'$&").replace(/"/g, '""')}"`;
router.get("/customers/export", wrap(async (req, res) => {
  const rows = await workspace.exportCustomers(req.user, req.query);
  const headings = ["Full Name", "Phone Number", "Email Address"];
  res.attachment("servicepay-my-customers." + req.query.format);
  res.set("X-Content-Type-Options", "nosniff");
  if (req.query.format === "csv") {
    return res.type("text/csv").send("\uFEFF" + [headings, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"));
  }
  const workbook = new (require("exceljs").Workbook)(), sheet = workbook.addWorksheet("Customers");
  sheet.addRows([headings, ...rows]); sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach(column => { column.width = 30; });
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(Buffer.from(await workbook.xlsx.writeBuffer()));
}));
router.get("/customers/:id/transactions", wrap(async (req, res) => ok(res, await workspace.customerTransactions(req.user, req.params.id, req.query))));
router.get("/customers/:id", wrap(async (req, res) => ok(res, await workspace.customerDetail(req.user, req.params.id, req.query))));
router.get("/withdrawals", wrap(async (req, res) => ok(res, await workspace.withdrawals(req.user, req.query))));
router.post("/withdrawals",
  require("../middleware/accountRestriction.middleware").requireNoRestriction("BLOCK_WITHDRAWALS", "BLOCK_WALLET_DEBIT"),
  wrap(async (req, res) => {
    await analytics.scope(req.user);
    req.commissionCustodyOnly = true;
    return require("../controllers/withdrawal.controller").createWithdrawal(req, res);
  }));
router.get("/complaints", wrap(async (req, res) => ok(res, await complaints.list(req.user, req.query))));
router.post("/complaints", wrap(async (req, res) => {
  const data = await complaints.create(req.user, req.body || {});
  res.status(data.duplicate ? 200 : 201).json({ success: true, data });
}));
router.get("/complaints/:id", wrap(async (req, res) => ok(res, await complaints.detail(req.user, req.params.id))));
router.post("/complaints/:id/replies", wrap(async (req, res) => ok(res, await complaints.reply(req.user, req.params.id, req.body || {}))));
module.exports = router;
module.exports.csvCell = csvCell;
