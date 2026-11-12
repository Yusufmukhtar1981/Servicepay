"use strict";
const S = require("../services/executiveControl.service");
const Audit = require("../models/adminAuditLog.model");
const active = new Set();
const audit = async (req, action) => Audit.create({ actorId: req.user._id, actorRole: req.user.role,
  action, reason: "Executive Control Center read-only reporting", status: "SUCCESSFUL",
  metadata: { module: "EXECUTIVE_CONTROL", period: S.period(req.query).public,
    kind: req.query.kind || null, format: req.query.format || null } });
const wrap = fn => async (req, res) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  const key = String(req.user._id);
  if (active.has(key) || active.size >= 2) return res.status(429).json({ success: false, message: "Executive reporting is busy. Retry shortly." });
  active.add(key);
  let released = false;
  const release = () => { if (!released) { released = true; active.delete(key); } };
  res.once("finish", release);
  try { await fn(req, res); }
  catch (e) { if (!res.headersSent) res.status(e.status || e.statusCode || 503).json({ success: false,
    message: e.status || e.statusCode ? e.message : "Executive reporting is temporarily unavailable; no financial records were changed." }); }
  finally { res.off("finish", release); release(); }
};
for (const name of ["overview", "finance", "marketing", "health"]) exports[name] = wrap(async (req, res) => {
  const data = await S[name](req, req.query);
  await audit(req, name === "finance" ? "EXECUTIVE_FINANCIAL_REPORT_VIEWED" : "EXECUTIVE_REPORT_VIEWED");
  res.json({ success: true, data });
});
function rows(value, prefix = "", output = []) {
  if (output.length > 10000) throw S.fail("Report exceeds 10,000 rows. Narrow the reporting period.", 422);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, item] of Object.entries(value)) {
      if (["items", "topCount", "topVolume", "transactionRows"].includes(key)) continue;
      rows(item, prefix ? prefix + "." + key : key, output);
    }
  } else output.push([prefix, value === null || value === undefined ? "DATA UNAVAILABLE" : String(value)]);
  return output;
}
const cell = value => '"' + (/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"';
exports.rows = rows;
exports.report = wrap(async (req, res) => {
  const kind = req.query.kind || "business", format = req.query.format || "pdf";
  if (!S.capabilities(req).export) throw S.fail("Executive export permission is required.", 403);
  if (!["business", "customer-growth", "transactions", "finance", "marketing"].includes(kind) ||
      !["csv", "xlsx", "pdf"].includes(format)) throw S.fail("Unsupported report kind or format.");
  let data;
  if (kind === "finance" || kind === "marketing") data = await S[kind](req, req.query);
  else {
    const overview = await S.overview(req, req.query);
    data = kind === "customer-growth" ? { period: overview.period, customers: overview.customers, definitions: overview.definitions } :
      kind === "transactions" ? { period: overview.period, transactions: overview.transactions, definitions: overview.definitions } : overview;
  }
  const records = [["Report", `ServicePay Executive ${kind}`], ["Currency", "NGN"],
    ["Timezone", "Africa/Lagos"], ["Generated at", new Date().toISOString()], ...rows(data)];
  let buffer, type;
  if (format === "csv") { buffer = Buffer.from("\uFEFF" + records.map(r => r.map(cell).join(",")).join("\r\n")); type = "text/csv; charset=utf-8"; }
  if (format === "xlsx") {
    const Excel = require("exceljs"), book = new Excel.Workbook(), sheet = book.addWorksheet("Executive report");
    sheet.columns = [{ header: "Metric / source", width: 64 }, { header: "Recorded value / limitation", width: 80 }];
    sheet.addRows(records); sheet.views = [{ state: "frozen", ySplit: 1 }];
    buffer = Buffer.from(await book.xlsx.writeBuffer()); type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (format === "pdf") {
    const PDF = require("pdfkit"), doc = new PDF({ margin: 36 }), chunks = [];
    const done = new Promise((resolve, reject) => { doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
    doc.fontSize(17).text("ServicePay Executive Report").moveDown().fontSize(9);
    for (const [key, value] of records) doc.text(`${key}: ${value}`).moveDown(0.25);
    doc.end(); buffer = await done; type = "application/pdf";
  }
  await audit(req, "EXECUTIVE_REPORT_EXPORTED");
  res.set({ "Content-Type": type, "Content-Disposition": `attachment; filename="ServicePay-Executive-${kind}-${S.period(req.query).public.from}.${format}"` });
  res.send(buffer);
});
