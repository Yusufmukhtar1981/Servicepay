"use strict";
const c = require("./expenseManagement.common");
const { Expense, Event, r } = c;
const MAX_ROWS = 10000;
const TYPES = ["daily", "weekly", "monthly", "annual", "department", "vendor", "approval"];
const COVERAGE = "Current approved and paid expense records count toward totals. Pending/rejected/cancelled/reversed requests do not. Payment and reversal entries are manual company records, not provider-verified bank settlements. Historical pre-workflow expenses remain unchanged in Financial Control Center. Reports reflect current recorded status, not a reconstructed prior-period close.";
function add(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw r.fail("The report total exceeds exact supported precision. Narrow the report filters.", 422);
  return result;
}
function group(rows, key, label) {
  const map = new Map();
  for (const row of rows) {
    const id = String(key(row));
    const item = map.get(id) || { id, label: label(row), amountMinor: 0, count: 0 };
    item.amountMinor = add(item.amountMinor, row.amountMinor);
    item.count++;
    map.set(id, item);
  }
  return [...map.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label));
}
async function loadRows(query, projection) {
  const rows = await Expense.find({ $and: [query, { $or: [
    { recordType: { $ne: "DEPARTMENT_REQUEST" } },
    { recordType: "DEPARTMENT_REQUEST", status: { $in: ["PAID", "REVERSED"] } },
  ] }] }).select(projection ? `${projection} recordType payment.amountMinor` : "").sort({ expenseDate: 1, _id: 1 })
    .limit(MAX_ROWS + 1).maxTimeMS(10000).lean();
  if (rows.length > MAX_ROWS) throw r.fail("More than 10,000 expenses match. Narrow the report filters.", 422);
  return rows.map(row => row.recordType === "DEPARTMENT_REQUEST"
    ? { ...row, amountMinor: row.payment.amountMinor } : row);
}
function money(minor) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
async function summary(input, actor) {
  c.allow(actor, r.PERMISSIONS.view);
  await c.storage.requireReady();
  const match = r.filters(input);
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const projection = "amountMinor status categoryId categoryName vendorId vendorName beneficiary department branch expenseDate";
  const [rows, monthRows, yearRows] = await Promise.all([
    loadRows(match, projection),
    loadRows({ ...match, expenseDate: { $gte: `${today.slice(0, 7)}-01`, $lte: today } }, projection),
    loadRows({ ...match, expenseDate: { $gte: `${today.slice(0, 4)}-01-01`, $lte: today } }, projection),
  ]);
  const included = row => ["APPROVED", "PAID"].includes(row.status);
  const sum = data => data.reduce((total, row) => add(total, row.amountMinor), 0);
  const withStatus = status => rows.filter(row => row.status === status);
  const realized = rows.filter(included);
  return {
    period: { from: match.expenseDate.$gte, to: match.expenseDate.$lte },
    currency: "NGN", generatedAt: new Date().toISOString(), coverageNote: COVERAGE,
    totals: {
      totalMinor: sum(realized), monthlyMinor: sum(monthRows.filter(included)),
      yearlyMinor: sum(yearRows.filter(included)), totalCount: rows.length,
      pendingMinor: sum(withStatus("PENDING_APPROVAL")), pendingCount: withStatus("PENDING_APPROVAL").length,
      approvedMinor: sum(withStatus("APPROVED")), approvedCount: withStatus("APPROVED").length,
      paidMinor: sum(withStatus("PAID")), paidCount: withStatus("PAID").length,
      rejectedCount: withStatus("REJECTED").length,
      reversedMinor: sum(withStatus("REVERSED")), cancelledMinor: sum(withStatus("CANCELLED")),
    },
    byCategory: group(realized, row => row.categoryId, row => row.categoryName),
    byDepartment: group(realized, row => r.normalizedKey(row.department || `Branch: ${row.branch}`),
      row => row.department || `Branch: ${row.branch}`),
    byVendor: group(realized, row => row.vendorId || r.normalizedKey(row.beneficiary),
      row => row.vendorName || row.beneficiary),
    daily: group(realized, row => row.expenseDate, row => row.expenseDate)
      .map(row => ({ date: row.id, amountMinor: row.amountMinor, count: row.count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
async function audit(input, actor, expenseId) {
  c.allow(actor, r.PERMISSIONS.audit);
  await c.storage.requireReady();
  const page = Math.max(1, Number.parseInt(input.page || "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(Number.parseInt(input.pageSize || "30", 10) || 30, 100));
  const match = expenseId ? { subjectType: "EXPENSE", subjectId: r.id(expenseId, "Expense ID") } : {};
  if (input.from || input.to) {
    const range = r.filters(input).expenseDate;
    match.at = { $gte: new Date(`${range.$gte}T00:00:00.000+01:00`),
      $lte: new Date(`${range.$lte}T23:59:59.999+01:00`) };
  }
  const [items, total] = await Promise.all([
    Event.find(match).sort({ at: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).maxTimeMS(10000).lean(),
    Event.countDocuments(match).maxTimeMS(10000),
  ]);
  return {
    items: items.map(({ requestKey, requestHash, _id, ...item }) => ({ ...item, id: String(_id) })),
    total, page, pageSize,
  };
}
function period(row, type) {
  if (type === "monthly") return row.expenseDate.slice(0, 7);
  if (type === "annual") return row.expenseDate.slice(0, 4);
  if (type === "department") return row.department || `Branch: ${row.branch}`;
  if (type === "vendor") return row.vendorName || row.beneficiary;
  if (type === "approval") return row.status;
  if (type === "weekly") {
    const date = new Date(`${row.expenseDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return `Week of ${date.toISOString().slice(0, 10)}`;
  }
  return row.expenseDate;
}
function approvalText(row) {
  return (row.approvals || []).map(step =>
    `${step.label}: ${step.actorName || step.actorId} at ${new Date(step.at).toISOString()}; ${step.comments}`).join("\n");
}
async function exportReport(input, actor) {
  c.allow(actor, r.PERMISSIONS.view);
  c.allow(actor, r.PERMISSIONS.export);
  await c.storage.requireReady();
  const type = input.type || "monthly", format = input.format || "pdf";
  if (!TYPES.includes(type) || !["pdf", "xlsx"].includes(format)) throw r.fail("Choose a supported expense report and PDF or Excel.");
  const match = r.filters(input), rows = await loadRows(match);
  const generatedAt = new Date().toISOString();
  const filename = `ServicePay-Expenses-${type}-${match.expenseDate.$gte}-${match.expenseDate.$lte}.${format}`;
  const title = `ServicePay ${type[0].toUpperCase() + type.slice(1)} Expense Report`;
  let buffer;
  if (format === "xlsx") {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ServicePay";
    workbook.created = new Date();
    const notes = workbook.addWorksheet("Report scope");
    notes.addRows([["Report", title], ["From", match.expenseDate.$gte], ["To", match.expenseDate.$lte],
      ["Currency", "NGN"], ["Timezone", "Africa/Lagos"], ["Generated", generatedAt], ["Coverage", COVERAGE]]);
    notes.getColumn(1).width = 18; notes.getColumn(2).width = 110;
    notes.getColumn(2).alignment = { wrapText: true, vertical: "top" };
    const sheet = workbook.addWorksheet("Expense records", { views: [{ state: "frozen", ySplit: 1 }] });
    const columns = [
      ["Period", "period", 24], ["Expense ID", "id", 28], ["Title", "title", 30],
      ["Category", "categoryName", 24], ["Description", "description", 45],
      ["Business purpose", "businessPurpose", 40], ["Amount NGN", "amount", 22],
      ["Exact amount kobo", "amountMinor", 24], ["Expense date", "expenseDate", 16],
      ["Payment method", "paymentMethod", 20], ["Vendor/beneficiary", "vendor", 30],
      ["Reference", "reference", 28], ["Department", "department", 24], ["Branch", "branch", 24],
      ["Status", "status", 22], ["Created by", "createdByName", 25], ["Approval history", "approvals", 65],
      ["Paid date", "paidDate", 16], ["External payment reference", "paymentReference", 30],
      ["Reversal date", "reversalDate", 16], ["External reversal reference", "reversalReference", 30],
      ["Reversal/cancellation reason", "closureReason", 45], ["Evidence count", "evidenceCount", 18],
      ["Evidence exception", "exception", 45],
    ];
    sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
    for (const row of rows) {
      // Strings are plain cell values, never formulas. Exact minor-unit text
      // remains available even beyond Excel's 15-digit numeric precision.
      sheet.addRow({ ...row, period: period(row, type), id: String(row._id),
        amount: money(row.amountMinor), amountMinor: String(row.amountMinor),
        vendor: row.vendorName || row.beneficiary, approvals: approvalText(row),
        paidDate: row.payment?.paidDate || "", paymentReference: row.payment?.reference || "",
        reversalDate: row.reversal?.date || "", reversalReference: row.reversal?.reference || "",
        closureReason: row.reversal?.reason || row.cancellation?.reason || "",
        evidenceCount: row.documentIds.length, exception: row.evidenceException?.reason || "" });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF087A45" } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
    sheet.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; });
    buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  } else {
    const PDFDocument = require("pdfkit");
    buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 36 });
      const chunks = [];
      doc.on("data", chunk => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(17).text(title).moveDown();
      doc.fontSize(9).text(`NGN | ${match.expenseDate.$gte} to ${match.expenseDate.$lte} | Africa/Lagos`);
      doc.text(`Generated ${generatedAt}`).moveDown().text(COVERAGE).moveDown();
      if (!rows.length) doc.text("No expense records match the selected filters.");
      for (const row of rows) {
        if (doc.y > 650) doc.addPage();
        doc.fontSize(11).text(`${period(row, type)} | ${row.title}`).moveDown(0.3);
        doc.fontSize(9).text(`NGN ${money(row.amountMinor)} | ${row.status} | ${row.expenseDate}`);
        for (const [label, value] of [
          ["Reference", row.reference], ["Category", row.categoryName],
          ["Vendor/beneficiary", row.vendorName || row.beneficiary],
          ["Department/branch", [row.department, row.branch].filter(Boolean).join(" / ")],
          ["Description", row.description], ["Purpose", row.businessPurpose],
          ["Created by", row.createdByName], ["Approvals", approvalText(row) || "No completed approval step"],
          ["External payment", row.payment ? `${row.payment.paidDate} | ${row.payment.method} | ${row.payment.reference} | Manual record only` : "Not recorded"],
          ["Reversal/cancellation", row.reversal ? `${row.reversal.date} | ${row.reversal.reference} | ${row.reversal.reason}` : row.cancellation?.reason || "Not recorded"],
          ["Evidence", `${row.documentIds.length} supporting document(s); exception: ${row.evidenceException?.reason || "None"}`],
        ]) doc.text(`${label}: ${value || "Not supplied"}`);
        doc.moveDown();
      }
      doc.end();
    });
  }
  await c.append({
    subjectType: "REPORT", subjectId: r.hash({ actor: actor.id, generatedAt, type, format }),
    action: "EXPENSE_REPORT_EXPORTED", actor, reason: "Authorized company expense export; no payment or customer wallet action.",
    before: null, after: { type, format, filters: input, rowCount: rows.length, generatedAt },
  });
  return { buffer, filename, mimeType: format === "pdf"
    ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
module.exports = { summary, audit, exportReport, group, add, money, period, TYPES, COVERAGE, MAX_ROWS };
