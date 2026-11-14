"use strict";
const kinds = ["AGENT", "MERCHANT"];
const billServices = ["AIRTIME", "DATA", "ELECTRICITY", "CABLE", "EXAM_PIN"];
const features = Object.freeze({ merchantQr: false, payByLink: false, automaticPayouts: false,
  rechargeVouchers: false, dataVouchers: false, specialPurchasePricing: false, bulkPurchases: false });
function fail(message, code = "NETWORK_VALIDATION", status = 400) {
  const error = new Error(message); Object.assign(error, { code, status }); throw error;
}
function text(value, name, max = 200, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    fail(`Invalid ${name}.`);
  return value.trim();
}
function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Invalid ${name}.`);
  return value;
}
function kind(value) {
  const canonical = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!kinds.includes(canonical)) fail("Select Agent or Merchant.");
  return canonical;
}
function services(value) {
  if (!Array.isArray(value) || value.length > billServices.length || value.some(v => !billServices.includes(v))) fail("Unsupported business service.");
  return [...new Set(value)];
}
function kobo(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) fail("Invalid source transaction amount.");
  return integer(Math.round((amount + Number.EPSILON) * 100), "source amount");
}
function refunded(tx) {
  return tx.status === "REFUNDED" || !!(tx.reversalLedgerEntryId || tx.reversalTransactionId || tx.reversedTransactionId || tx.reversalReference);
}
function confirmed(tx) {
  return tx.status === "SUCCESSFUL" && tx.dispatchStatus === "SUCCEEDED" &&
    ["SUCCESS", "SUCCESSFUL", "COMPLETED"].includes(String(tx.providerStatus).toUpperCase()) &&
    !!tx.debitLedgerEntryId && !refunded(tx);
}
function commission(tx, rule) {
  if (!confirmed(tx) || !rule.enabled || !billServices.includes(tx.serviceType)) return 0;
  const amount = kobo(tx.amount);
  if (amount < rule.minAmountKobo || (rule.maxAmountKobo != null && amount > rule.maxAmountKobo)) return 0;
  const value = integer(rule.value, "commission value", 0, rule.mode === "PERCENT" ? 10000 : Number.MAX_SAFE_INTEGER);
  // An additional retail liability can never exceed documented remaining company
  // margin; legacy/unproven margin earns nothing. No existing balance is changed.
  const remainingMargin = kobo(tx.servicepayProfit || 0);
  const proposed = rule.mode === "PERCENT" ? Number(BigInt(amount) * BigInt(value) / 10000n) : value;
  return Math.min(integer(proposed, "commission"), remainingMargin);
}
function approvalCovers(profile, date, service) {
  const at = new Date(date).getTime();
  return Number.isFinite(at) && (profile.approvalWindows || []).some(w =>
    at >= new Date(w.start).getTime() && (!w.end || at < new Date(w.end).getTime()) &&
    (!service || (w.services || []).includes(service)));
}
function transition(profile, status) {
  const allowed = {
    DRAFT: [], SUBMITTED: ["UNDER_REVIEW", "REJECTED", "APPROVED"],
    UNDER_REVIEW: ["REJECTED", "APPROVED"], APPROVED: ["SUSPENDED"],
    REJECTED: [], SUSPENDED: ["APPROVED"],
  };
  if (!(allowed[profile.status] || []).includes(status)) fail("This application state cannot make that transition.", "NETWORK_CONFLICT", 409);
}
function totals(rows) {
  const groups = new Map();
  const out = { earnedKobo: 0, pendingKobo: 0, paidKobo: 0, reversedKobo: 0, recoveryKobo: 0 };
  for (const row of rows) {
    const key = String(row.transaction);
    const current = groups.get(key) || { earned: 0, reversed: 0, paid: 0 };
    if (row.event === "ACCRUAL") current.earned += row.amountKobo;
    if (row.event === "REVERSAL") current.reversed += -row.amountKobo;
    if (row.event === "SETTLEMENT") current.paid += -row.amountKobo;
    groups.set(key, current);
  }
  for (const row of groups.values()) {
    out.earnedKobo += row.earned; out.reversedKobo += row.reversed; out.paidKobo += row.paid;
    out.pendingKobo += Math.max(0, row.earned - row.reversed - row.paid);
    out.recoveryKobo += Math.max(0, row.paid - (row.earned - row.reversed));
  }
  return out;
}
function csv(rows) {
  const cell = value => `"${(/^[=+\-@\t\r]/.test(String(value ?? "")) ? "'" : "") + String(value ?? "").replace(/"/g, '""')}"`;
  return ["reference,service,status,amount_kobo,created_at", ...rows.map(r =>
    [r.reference, r.serviceType, r.status, r.amountKobo, new Date(r.createdAt).toISOString()].map(cell).join(","))].join("\r\n");
}
module.exports = { kinds, billServices, features, fail, text, integer, kind, services, kobo, refunded, confirmed, commission, approvalCovers, transition, totals, csv };
