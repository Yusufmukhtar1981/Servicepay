// Reporting only. Do not import payment admission, providers or wallet writers.
const bill = require("./revenueAccountingRules");
const crypto = require("node:crypto");
const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED"]);
const PENDING = new Set(["PENDING", "INITIATED", "PROCESSING", "UNKNOWN", "UNDER_REVIEW", "REVERSAL_PENDING"]);
const REFUNDED = new Set(["REFUNDED", "REVERSED"]);
const NON_SALES = new Set(["WALLET_FUNDING", "REFERRAL_BONUS", "REFERRAL_BONUS_REVERSAL",
  "EMPOWERMENT_FUNDING", "EMPOWERMENT_DISBURSEMENT", "SOLAR_DEPOSIT", "SOLAR_INSTALLMENT",
  "PHONE_FINANCING_DEPOSIT", "PHONE_FINANCING_INSTALLMENT", "PHONE_FINANCING_REFUND", "TRANSFER"]);
const CATEGORIES = ["SALARY", "RENT", "MARKETING", "HOSTING", "PROVIDER_CHARGE", "LOGISTICS", "ADMINISTRATION", "OTHER"];
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const text = value => typeof value === "string" ? value.trim() : "";
// Canonical internal codes, verified against the existing purchase controller.
// This labels immutable snapshots; it never reads or changes today's catalogue.
const NETWORK_NAMES = { "01": "MTN", "02": "Glo", "03": "9mobile", "04": "Airtel" };
const reportNetwork = value => {
  const raw = text(value);
  if (Object.hasOwn(NETWORK_NAMES, raw)) return NETWORK_NAMES[raw];
  return Object.values(NETWORK_NAMES).find(label => label.toUpperCase() === raw.toUpperCase()) || raw || "UNKNOWN";
};
const day = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw fail("Use YYYY-MM-DD dates.");
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw fail("Invalid calendar date.");
  return value;
};
const nigeriaDay = date => new Date(new Date(date).getTime() + 3600000).toISOString().slice(0, 10);
function filters(query = {}, now = new Date()) {
  const allowed = new Set(["from", "to", "service", "network", "branch", "format"]);
  if (Object.keys(query).some(k => !allowed.has(k))) throw fail("Unsupported financial report filter.");
  const today = nigeriaDay(now);
  const from = day(query.from || today.slice(0, 7) + "-01"), to = day(query.to || today);
  if (from > to || (new Date(to) - new Date(from)) / 86400000 > 365) throw fail("Choose a range of at most 366 days.");
  const result = { from, to };
  for (const key of ["service", "network", "branch"]) {
    const value = query[key] === undefined ? "" : text(query[key]);
    if (query[key] !== undefined && typeof query[key] !== "string") throw fail("Invalid filter.");
    if (value && (value.length > 100 || !/^[A-Za-z0-9 _.:/-]+$/.test(value))) throw fail("Invalid filter.");
    result[key] = value;
  }
  if (result.branch && !/^[a-f0-9]{24}$/i.test(result.branch)) throw fail("Invalid branch ID.");
  if (query.format && !["csv", "pdf"].includes(query.format)) throw fail("Choose CSV or PDF.");
  return result;
}
const dateMatch = f => ({ $gte: new Date(f.from + "T00:00:00+01:00"),
  $lt: new Date(new Date(f.to + "T00:00:00+01:00").getTime() + 86400000) });
const number = value => bill.money(value) === null || value < 0 ? null : bill.major(bill.money(value));
const sum = (rows, key) => bill.major(rows.reduce((n, row) => {
  const next = n + (bill.money(row[key]) || 0);
  if (!Number.isSafeInteger(next)) throw fail("Financial total exceeds safe integer precision.", 422);
  return next;
}, 0));
function transaction(t, commissionMinor = null) {
  const p = t.providerResponse || {}, a = p.financialAccounting || {};
  const state = String(t.status || "").toUpperCase();
  const reversed = REFUNDED.has(state) || Boolean(t.reversalReference || t.reversalTransactionId || t.reversedTransactionId);
  const complete = SUCCESS.has(state) && !reversed;
  const row = { id: String(t._id), reference: text(t.reference), service: t.serviceType || "OTHER",
    network: reportNetwork(p.networkName || p.network?.name || p.networkCode || p.network || p.airtimeLifecycle?.networkName),
    plan: text(p.planName || p.plan?.name || p.planId || p.plan_id) || "UNKNOWN",
    branch: t.branchId && t.hierarchyCapturedAt ? String(t.branchId) : "UNATTRIBUTED",
    date: nigeriaDay(t.createdAt), status: state, amount: number(t.amount),
    transactionValue: complete && !NON_SALES.has(t.serviceType) ? number(t.amount) : 0,
    recordedRevenue: null, providerCosts: null, grossProfit: null,
    commissions: null, directCosts: null, costSource: "DATA UNAVAILABLE",
    reason: complete ? "EARNINGS_EVIDENCE_UNAVAILABLE" : "NOT_EARNED",
    confirmed: false, pending: PENDING.has(state), failed: state === "FAILED", refunded: reversed };
  if (!complete) {
    row.recordedRevenue = row.providerCosts = row.grossProfit = 0;
    return row;
  }
  if (row.amount === null) { row.reason = "INVALID_TRANSACTION_AMOUNT"; return row; }
  if (bill.SERVICES.includes(t.serviceType)) {
    if (!bill.providerConfirmed(t)) { row.reason = "PROVIDER_EVIDENCE_REQUIRED"; return row; }
    row.confirmed = true;
    const projected = bill.projectTransaction(t, commissionMinor);
    row.providerCosts = projected.providerCost;
    row.costSource = projected.costSource;
    row.recordedRevenue = projected.grossProfit; // Earned margin; NOT the customer payment.
    row.commissions = projected.commissions;
    // Missing cost categories are unknown, not silently zero.
    const extraCostsKnown = ["providerFee", "processingFee", "otherDirectCosts"]
      .every(k => typeof a[k] === "number" && bill.money(a[k]) !== null && a[k] >= 0);
    row.directCosts = extraCostsKnown ? bill.major(["providerFee", "processingFee", "otherDirectCosts"]
      .reduce((n, key) => n + bill.money(a[key]), 0)) : null;
    row.grossProfit = extraCostsKnown ? projected.netProfit : null;
    row.reason = projected.providerCost === null ? "MISSING_PROVIDER_COST" :
      !extraCostsKnown ? "MISSING_DIRECT_COST_EVIDENCE" :
        projected.costSource !== "RECORDED_PROVIDER_INVOICE" ? "INVOICE_NOT_RECONCILED" : "RECORDED";
  }
  return row;
}
function totals(rows, expenses = null) {
  const earned = rows.filter(r => SUCCESS.has(r.status) && !r.refunded);
  const unknownRevenue = earned.filter(r => r.recordedRevenue === null).length;
  const unknownCost = earned.filter(r => r.providerCosts === null).length;
  const unknownProfit = earned.filter(r => r.grossProfit === null).length;
  return { totalCount: rows.length, successful: rows.filter(r => SUCCESS.has(r.status)).length,
    transactionValue: rows.some(row => row.transactionValue === null) ? null : sum(rows, "transactionValue"),
    recordedRevenue: sum(rows, "recordedRevenue"),
    knownProviderCosts: sum(rows, "providerCosts"), providerCosts: unknownCost ? null : sum(rows, "providerCosts"),
    grossProfit: unknownProfit ? null : sum(rows, "grossProfit"),
    operatingExpenses: expenses, netProfit: null,
    pending: rows.filter(r => r.pending).length, failed: rows.filter(r => r.failed).length,
    refunds: sum(rows.filter(r => r.refunded), "amount"), refundedCount: rows.filter(r => r.refunded).length,
    outstandingSettlements: null, unreconciled: rows.filter(r => !["RECORDED", "NOT_EARNED"].includes(r.reason) ||
      r.diagnostics?.length).length,
    missingRevenueCount: unknownRevenue, missingProviderCostCount: unknownCost,
    successRate: rows.length ? Math.round(rows.filter(r => SUCCESS.has(r.status)).length / rows.length * 10000) / 100 : null };
}
function grouped(rows, key) {
  return [...new Set(rows.map(r => r[key]))].sort().map(value =>
    ({ [key]: value, count: rows.filter(r => r[key] === value).length,
      ...totals(rows.filter(r => r[key] === value)) }));
}
function planRows(rows) {
  const groups = new Map();
  for (const r of rows.filter(r => r.service === "DATA" && r.confirmed && !r.refunded)) {
    const key = JSON.stringify([r.network, r.plan, r.amount, r.providerCosts, r.costSource]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map(rs => {
    const r = rs[0], margin = r.recordedRevenue;
    return { network: r.network, plan: r.plan, sellingPrice: r.amount, providerCost: r.providerCosts,
      costSource: r.costSource, grossMargin: margin,
      marginPercent: margin !== null && r.amount > 0 ? Math.round(margin / r.amount * 10000) / 100 : null,
      count: rs.filter(x => x.confirmed && !x.refunded).length,
      recordedEarnings: sum(rs, "recordedRevenue") };
  }).sort((a, b) => b.recordedEarnings - a.recordedEarnings);
}
function expense(input, now = new Date()) {
  const amount = bill.money(input.amount), reference = text(input.reference);
  const description = text(input.description), category = text(input.category), date = day(input.date);
  if (amount === null || amount <= 0 || amount > 100000000000 ||
      !CATEGORIES.includes(category) || reference.length < 3 || reference.length > 120 ||
      description.length < 5 || description.length > 500 || date > nigeriaDay(now) ||
      input.costNotAlreadyDeducted !== true) throw fail("A valid expense and independent-cost acknowledgement are required.");
  let document = null;
  if (input.supportingDocument) {
    const d = input.supportingDocument;
    if (typeof d.dataBase64 !== "string" || d.dataBase64.length > 349528 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(d.dataBase64)) throw fail("Invalid supporting document.");
    const bytes = Buffer.from(d.dataBase64, "base64");
    const type = bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ? "application/pdf" :
      bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" :
        bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : null;
    if (!type || !bytes.length || bytes.length > 262144 || type !== d.type) throw fail("Use PDF, PNG or JPEG up to 256 KiB.");
    document = { name: text(d.name).replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 100) || "evidence",
      type, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      dataBase64: bytes.toString("base64") };
  }
  const value = { amount: bill.major(amount), category, date, description, reference,
    supportingDocument: document, costNotAlreadyDeducted: true };
  const digest = v => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const fingerprint = digest([category, amount, date, description.toLowerCase().replace(/\s+/g, " ")]);
  return { value, fingerprint, payloadHash: digest(value),
    id: digest(["financial-expense-reference", reference.toUpperCase()]).slice(0, 24),
    claimId: digest(["financial-expense-fingerprint", fingerprint]).slice(0, 24) };
}
module.exports = { transaction, totals, grouped, planRows, filters, dateMatch, nigeriaDay, reportNetwork,
  expense, CATEGORIES, SUCCESS, NON_SALES, sum, fail };
