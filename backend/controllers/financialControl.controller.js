const mongoose = require("mongoose");
const Audit = require("../models/adminAuditLog.model");
const Transaction = require("../models/transaction.model");
const s = require("../services/financialControl.service");
const r = require("../services/financialControl.rules");
async function audit(req, action) {
  await Audit.create({ actorId: req.user._id, actorRole: req.user.role,
    action, reason: "Financial Control Center " + (action === "FINANCIAL_REPORT_EXPORTED" ? "export" : "access"),
    metadata: { financialControl: true, filters: r.filters(req.query),
      format: req.query.format || null }, status: "SUCCESSFUL" });
}
const endpoint = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    res.status(error.statusCode || 503).json({ success: false,
      message: error.statusCode ? error.message : "Financial reporting is temporarily unavailable. No financial records were changed." });
  }
};
exports.summary = endpoint(async (req, res) => {
  const data = await s.summary(req.query);
  await audit(req, "FINANCIAL_REPORT_VIEWED");
  const { transactionRows, ...summary } = data;
  res.json({ success: true, data: summary });
});
exports.expenses = endpoint(async (req, res) => {
  const data = await s.expenses(req.query);
  await audit(req, "FINANCIAL_REPORT_VIEWED");
  res.json({ success: true, data });
});
exports.recordExpense = endpoint(async (req, res) => {
  const data = await s.recordExpense(req.body, req.user);
  res.status(data.idempotent ? 200 : 201).json({ success: true, data });
});
exports.document = endpoint(async (req, res) => {
  const doc = await s.document(req.params.id);
  await audit(req, "FINANCIAL_REPORT_VIEWED");
  res.set({ "Content-Type": doc.type, "Content-Disposition": `attachment; filename="${doc.name.replace(/["\r\n]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" });
  res.send(Buffer.from(doc.dataBase64, "base64"));
});
const csvCell = value => {
  const text = value === null || value === undefined ? "DATA UNAVAILABLE" : String(value);
  return '"' + (typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replace(/"/g, '""') + '"';
};
exports.csvCell = csvCell;
exports.report = endpoint(async (req, res) => {
  const f = r.filters(req.query), format = req.query.format || "csv";
  const data = await s.summary(req.query);
  await audit(req, "FINANCIAL_REPORT_EXPORTED");
  const printable = value => value === null || value === undefined ? "DATA UNAVAILABLE" : String(value);
  const filename = `Servicepay-Financial-Control-${f.from}-${f.to}.${format}`;
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  const metrics = [["Report", "Servicepay Financial Control Center"], ["Currency", "NGN"],
    ["From", f.from], ["To", f.to], ["Timezone", "Africa/Lagos"], ["Generated at", data.generatedAt],
    ["Reconciliation", data.reconciliation.status], ...Object.entries(data.totals)];
  const columns = ["reference", "date", "service", "network", "plan", "branch", "status", "amount",
    "transactionValue", "recordedRevenue", "providerCosts", "grossProfit", "commissions", "directCosts", "costSource", "reason"];
  if (format === "csv") {
    res.type("text/csv; charset=utf-8");
    const lines = [...metrics.map(row => row.map(csvCell).join(",")), "",
      ["Methodology", ...data.methodology].map(csvCell).join(","), "",
      columns.map(csvCell).join(","),
      ...data.transactionRows.map(row => columns.map(k => csvCell(row[k])).join(",")), "",
      ["Reconciliation issue", "Count", "Note"].map(csvCell).join(","),
      ...data.reconciliation.issues.map(i => [i.code, i.count, i.note].map(csvCell).join(","))];
    res.send("\uFEFF" + lines.join("\r\n"));
    return;
  }
  const PDF = require("pdfkit");
  const doc = new PDF({ size: "A4", margin: 36, autoFirstPage: true });
  res.type("application/pdf");
  doc.on("error", () => res.destroy());
  doc.pipe(res);
  doc.fontSize(18).text("Servicepay Financial Control Center");
  doc.moveDown().fontSize(9);
  for (const [key, value] of metrics) doc.text(`${key}: ${printable(value)}`);
  doc.moveDown().fontSize(12).text("Accounting methodology and limitations");
  doc.fontSize(9);
  for (const note of data.methodology) doc.moveDown(0.4).text(note);
  for (const [title, rows] of [["Revenue by service", data.services], ["Revenue by network", data.networks],
    ["Branch comparison", data.branches], ["Data plan profitability", data.plans],
    ["Source coverage (non-additive)", data.sourceCoverage], ["Reconciliation", data.reconciliation.issues]]) {
    doc.addPage().fontSize(13).text(title).moveDown().fontSize(8);
    for (const row of rows) {
      doc.text(Object.entries(row).map(([key, value]) => key + ": " + printable(value)).join(" | ")).moveDown(0.6);
    }
  }
  doc.end();
});
exports.operational = endpoint(async (req, res) => {
  const f = r.filters(req.query);
  const match = { createdAt: r.dateMatch(f) };
  if (req.staffAccess.roleName === "BRANCH_MANAGER") {
    const branch = req.staffAccess.scope?.branchId || req.user.branchId;
    if (!mongoose.isValidObjectId(branch) || (f.branch && f.branch !== String(branch))) throw r.fail("Assigned branch access required.", 403);
    match.branchId = new mongoose.Types.ObjectId(String(branch));
    match.hierarchyCapturedAt = { $type: "date" };
  } else if (f.branch) match.branchId = new mongoose.Types.ObjectId(f.branch);
  if (f.network) throw r.fail("Network filtering is unavailable on operational summaries.");
  if (f.service) match.serviceType = f.service;
  const rows = await Transaction.aggregate([{ $match: match }, { $group: { _id: "$status",
    count: { $sum: 1 }, transactionValue: { $sum: "$amount" } } }]).option({ maxTimeMS: 10000 });
  // No company revenue, provider cost, profit, expense or settlement information.
  res.json({ success: true, data: { period: { from: f.from, to: f.to }, statuses: rows,
    notice: "Recorded operational volume only; not company revenue or profit. Historical unverified branch custody is excluded." } });
});
