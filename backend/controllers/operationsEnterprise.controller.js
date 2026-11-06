const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Case = require("../models/fintechCase.model");
const Audit = require("../models/adminAuditLog.model");
const enterprise = require("../services/operationsEnterprise.service");
const safe = require("../services/supportWorkspace.service");
const validId = value => /^[a-f0-9]{24}$/i.test(String(value || ""));
const clean = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const handle = fn => async (req, res) => {
  try {
    if (!enterprise.operational(req)) throw enterprise.fail(403, "Operations access required.");
    res.set?.("Cache-Control", "no-store");
    return await fn(req, res);
  } catch (error) {
    return res.status(error.statusCode || 503).json({ success: false,
      message: error.statusCode ? error.message : "Operational records are temporarily unavailable. Retry safely." });
  }
};
const check = (req, permission) => {
  if (!enterprise.permitted(req, permission)) throw enterprise.fail(403, "Explicit operational permission required.");
};
const audit = (req, action, reason, metadata, session) => Audit.create([{
  actorId: req.user._id, actorRole: req.user.role, actorName: clean(req.user.fullName, 200),
  action, reason, metadata, requestMethod: req.method, requestPath: req.originalUrl,
}], { session });
exports.summary = handle(async (req, res) => res.json({ success: true, data: await enterprise.summary(req, req.query) }));
exports.detail = handle(async (req, res) => {
  if (!validId(req.params.id)) throw enterprise.fail(404, "Transaction not found.");
  const t = await Transaction.findById(req.params.id)
    .select("_id reference serviceType status amount createdAt updatedAt customerId providerStatus settledAt providerResponse.code providerResponse.errorCode providerResponse.statusReconciliation.lastCheckedAt")
    .maxTimeMS(5000).lean();
  if (!t) throw enterprise.fail(404, "Transaction not found.");
  const [customer, events] = await Promise.all([
    User.findById(t.customerId).select("_id fullName phone email status walletBalance").lean(),
    Audit.find({ $or: [{ targetTransactionId: t._id }, { "metadata.originalTransactionId": String(t._id) },
      { "metadata.transactionId": String(t._id) }] }).select("action createdAt reason actorName").sort({ createdAt: -1 }).limit(40).lean(),
  ]);
  const code = safe.safeCode(t.providerResponse?.code || t.providerResponse?.errorCode);
  const end = t.settledAt ? new Date(t.settledAt).getTime() : NaN;
  const duration = end - new Date(t.createdAt).getTime();
  const refund = await require("../services/manualRefund.service").detail(t._id);
  return res.json({ success: true, data: {
    transaction: { id: String(t._id), reference: t.reference, type: t.serviceType, status: t.status,
      amount: t.amount, createdAt: t.createdAt, updatedAt: t.updatedAt },
    customer: customer ? { id: String(customer._id), fullName: customer.fullName, status: customer.status,
      phone: safe.maskPhone(customer.phone), email: safe.maskEmail(customer.email), walletBalance: customer.walletBalance } : null,
    history: events.map(e => ({ action: e.action, createdAt: e.createdAt, reason: e.reason, actorName: e.actorName })),
    providerDiagnostics: { code, status: safe.safeCode(t.providerStatus), message: safe.diagnostic(code, t.status) },
    processingDurationMs: Number.isFinite(duration) && duration >= 0 ? duration : null,
    canRefund: enterprise.permissions(req).refund && refund?.refund?.eligible === true,
    refundEligibility: refund.refund,
    complaints: await Case.find({ type: "COMPLAINT", $or: [{ transaction: t._id }, { "transactionContext.sourceId": String(t._id) }] })
      .select("_id caseReference subject status priority createdAt").limit(20).lean(),
  } });
});
exports.customerStatus = handle(async (req, res) => {
  check(req, "operations.customers.manage");
  const { status } = req.body || {}, reason = clean(req.body?.reason);
  if (!validId(req.params.id) || !["ACTIVE", "SUSPENDED"].includes(status) || reason.length < 10)
    throw enterprise.fail(400, "Select a customer, valid status and a reason of at least 10 characters.");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findOne({ _id: req.params.id, role: "CUSTOMER", isDeleted: { $ne: true } })
        .select("+authTokenVersion").session(session);
      if (!user) throw enterprise.fail(404, "Customer not found.");
      if (!["ACTIVE", "SUSPENDED"].includes(user.status)) throw enterprise.fail(409, "Security or compliance account status cannot be overridden.");
      if (user.status === status) return;
      // Restoration must be tied to this workflow's immutable hold evidence.
      if (status === "ACTIVE") {
        const previous = await Audit.findOne({ targetUserId: user._id, action: "USER_STATUS_UPDATED" })
          .sort({ createdAt: -1, _id: -1 }).session(session).lean();
        if (previous?.metadata?.operationsHold !== true || previous?.metadata?.status !== "SUSPENDED" ||
            Number(previous.metadata.authTokenVersion) !== Number(user.authTokenVersion || 0))
          throw enterprise.fail(409, "Only an unchanged operational hold created here can be restored. Escalate other restrictions to Head Office.");
      }
      const previousStatus = user.status;
      // CAS prevents concurrently overriding another status or revocation.
      const originalVersion = Number(user.authTokenVersion || 0);
      const changed = await User.updateOne({ _id: user._id, status: previousStatus,
        $or: [{ authTokenVersion: originalVersion }, ...(originalVersion === 0 ? [{ authTokenVersion: { $exists: false } }] : [])] },
      { $set: { status }, $inc: { authTokenVersion: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw enterprise.fail(409, "Customer security state changed. Refresh first.");
      await Audit.create([{
        actorId: req.user._id, actorRole: req.user.role, actorName: clean(req.user.fullName, 200),
        targetUserId: user._id, action: "USER_STATUS_UPDATED", reason,
        metadata: { operationsHold: true, previousStatus, status, authTokenVersion: originalVersion + 1 },
      }], { session });
    });
    return res.json({ success: true, data: { id: req.params.id, status } });
  } finally { await session.endSession(); }
});
exports.serviceStatus = handle(async (req, res) => {
  check(req, "operations.services.control");
  const controls = require("./featureControl.controller");
  const key = clean(req.params.key, 64);
  if (!controls.FEATURE_REGISTRY.some(v => v[0] === key) || controls.PROTECTED_FEATURES.has(key))
    throw enterprise.fail(403, "Protected financial services cannot be changed here.");
  if (typeof req.body?.enabled !== "boolean" || clean(req.body?.reason).length < 10)
    throw enterprise.fail(400, "Enabled flag and a reason of at least 10 characters are required.");
  // Delegate to the existing audited transaction; never introduce another settings store.
  req.body = { enabled: req.body.enabled, reason: clean(req.body.reason) };
  return controls.patch(req, res);
});
const neutral = value => {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
};
exports.exportReport = handle(async (req, res) => {
  if (!enterprise.permissions(req).reportExport) throw enterprise.fail(403, "Report export permission required.");
  const format = req.query.format || "csv";
  if (!["csv", "xlsx", "pdf"].includes(format)) throw enterprise.fail(400, "Format must be csv, xlsx or pdf.");
  const data = await enterprise.summary(req, req.query);
  const columns = ["Service", "Transactions", "Successful", "Failed", "Pending", "Refunded", "Other", "Recorded volume NGN", "Recorded margin NGN", "Refunded original NGN"];
  const rows = data.services.map(v => [v.service, v.total, v.successful, v.failed, v.pending, v.refunded, v.other, v.volume, v.recordedEarnings, v.refundAmount]);
  const title = `ServicePay operational report ${data.period}`;
  const notice = `${data.coverageNotice} ${data.financial.notice}`;
  const financialRows = [
    ["Recorded 24h margin NGN", data.financial.dailyEarnings],
    ["Recorded 7d margin NGN", data.financial.weeklyEarnings],
    ["Recorded 30d margin NGN", data.financial.monthlyEarnings],
    ["Selected period non-reversed commission records NGN", data.summary.commission],
    ["Selected period explicit charge snapshots NGN", data.summary.charges ?? "NOT RECORDED"],
    ["Charge snapshot sample count", data.summary.chargeSamples],
  ];
  let bytes, type;
  if (format === "csv") {
    const csv = row => row.map(value => `"${neutral(value).replaceAll('"', '""')}"`).join(",");
    bytes = Buffer.from("\ufeff" + [[title], [new Date(data.from).toISOString(), new Date(data.to).toISOString()], [notice], ...financialRows, [], columns, ...rows].map(csv).join("\r\n"));
    type = "text/csv; charset=utf-8";
  } else if (format === "xlsx") {
    const Excel = require("exceljs"), book = new Excel.Workbook(), sheet = book.addWorksheet("Operations");
    sheet.addRow([title]); sheet.addRow([notice]); sheet.addRow([data.from.toISOString(), data.to.toISOString()]);
    sheet.addRow(columns); for (const row of rows) sheet.addRow(row.map(v => typeof v === "number" ? v : neutral(v)));
    sheet.getRow(4).font = { bold: true }; sheet.columns.forEach(c => { c.width = 23; });
    sheet.addRow([]); for (const row of financialRows) sheet.addRow(row);
    bytes = Buffer.from(await book.xlsx.writeBuffer());
    type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else {
    const PDF = require("pdfkit"), doc = new PDF({ margin: 35, size: "A4", layout: "landscape" });
    const output = [];
    const ready = new Promise((resolve, reject) => { doc.on("data", v => output.push(v)); doc.on("end", () => resolve(Buffer.concat(output))); doc.on("error", reject); });
    doc.fontSize(18).text(title); doc.moveDown().fontSize(9).text(notice);
    doc.text(`${data.from.toISOString()} to ${data.to.toISOString()} UTC`);
    for (const row of financialRows) doc.text(`${row[0]}: ${row[1]}`);
    doc.moveDown(); doc.text("Service | Total | Success | Failed | Pending | Recorded margin NGN");
    for (const v of data.services) doc.moveDown(.35).text(`${v.service} | ${v.total} | ${v.successful} | ${v.failed} | ${v.pending} | ${Number(v.recordedEarnings).toFixed(2)}`);
    doc.end(); bytes = await ready; type = "application/pdf";
  }
  await audit(req, "FINANCIAL_REPORT_EXPORTED", "Exported operational aggregate report.", { period: data.period, format, rowCount: rows.length });
  res.set("Content-Type", type);
  res.set("Content-Disposition", `attachment; filename="Servicepay-operations-${data.period}.${format}"`);
  return res.send(bytes);
});
exports._test = { neutral };
