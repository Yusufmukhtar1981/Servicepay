"use strict";

const crypto = require("crypto");

const PERMISSIONS = Object.freeze({
  view: "expenses.view",
  create: "expenses.create",
  update: "expenses.update",
  approve: "expenses.approve",
  pay: "expenses.pay",
  categories: "expenses.manage_categories",
  vendors: "expenses.manage_vendors",
  policy: "expenses.manage_policy",
  documents: "expenses.documents",
  audit: "expenses.audit",
  export: "expenses.export",
  cancel: "expenses.cancel",
  exception: "expenses.evidence_exception",
});
const STATES = Object.freeze([
  "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID", "CANCELLED", "REVERSED",
]);
const PAYMENT_METHODS = Object.freeze(["BANK_TRANSFER", "CASH", "POS", "CARD", "CHEQUE", "OTHER"]);
const fail = (message, statusCode = 400, code = "INVALID_EXPENSE") =>
  Object.assign(new Error(message), { statusCode, code });
function text(value, label, maximum = 200, required = true) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw fail(`${label} is required.`);
  }
  const result = value.normalize("NFKC").trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) {
    throw fail(`${label} is invalid.`);
  }
  return result;
}
function id(value, label = "Record ID") {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw fail(`${label} is invalid.`);
  return value.toLowerCase();
}
function ids(value, label, maximum = 10) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) throw fail(`${label} is invalid.`);
  const result = value.map(item => id(item, label));
  if (new Set(result).size !== result.length) throw fail(`${label} contains duplicates.`);
  return result;
}
function amountMinor(value) {
  if (!["string", "number"].includes(typeof value)) throw fail("Enter a valid NGN amount.");
  const raw = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(raw)) {
    throw fail("NGN amounts must be positive with at most two decimal places.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw fail("NGN amount is outside the supported range.");
  return Number(minor);
}
function date(value, label = "Expense date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(`${label} must be YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw fail(`${label} is invalid.`);
  }
  return value;
}
const normalizedKey = value => text(value, "Reference", 200).toLocaleUpperCase("en-NG").replace(/\s+/g, " ");
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toHexString === "function") return value.toHexString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]),
  );
  return value;
}
const hash = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function requestKey(value, actorId) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) {
    throw fail("A valid Idempotency-Key is required.");
  }
  return hash({ actorId: String(actorId), key: value });
}
function expense(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Expense details are required.");
  const allowed = new Set(["title", "categoryId", "description", "businessPurpose", "amount", "expenseDate",
    "paymentMethod", "vendorId", "beneficiary", "reference", "department", "branch", "documentIds", "evidenceExceptionReason"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw fail("Unsupported expense field.");
  const paymentMethod = text(input.paymentMethod, "Payment method", 30);
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw fail("Select a valid payment method.");
  const vendorId = input.vendorId ? id(input.vendorId, "Vendor") : null;
  const beneficiary = text(input.beneficiary, "Beneficiary", 180, false);
  const department = text(input.department, "Department", 120, false);
  const branch = text(input.branch, "Branch", 120, false);
  if (!vendorId && !beneficiary) throw fail("Select a vendor or enter a beneficiary.");
  if (!department && !branch) throw fail("Enter a department or branch.");
  const documentIds = ids(input.documentIds, "Supporting documents");
  const evidenceExceptionReason = text(input.evidenceExceptionReason, "Evidence exception reason", 2000, false);
  if (!documentIds.length && evidenceExceptionReason.length < 10) {
    throw fail("Attach supporting evidence or provide an authorized documented exception.");
  }
  return {
    title: text(input.title, "Expense title", 180),
    categoryId: id(input.categoryId, "Category"),
    description: text(input.description, "Description", 4000),
    businessPurpose: text(input.businessPurpose, "Business purpose", 2000),
    amountMinor: amountMinor(input.amount), currency: "NGN",
    expenseDate: date(input.expenseDate), paymentMethod, vendorId, beneficiary,
    reference: text(input.reference, "Reference number", 180), department, branch,
    documentIds, evidenceExceptionReason,
  };
}
function approvalSteps(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw fail("Configure between one and eight approval steps.");
  }
  return input.map((step, index) => {
    if (!step || typeof step !== "object") throw fail("Approval step is invalid.");
    const userIds = ids(step.userIds, "Approver users", 100);
    const roleIds = ids(step.roleIds, "Approver roles", 30);
    if (!userIds.length && !roleIds.length) throw fail(`Approval step ${index + 1} needs an authorized user or role.`);
    return { label: text(step.label, "Approval step label", 100), userIds, roleIds };
  });
}
function canApprove(item, actor) {
  const actorId = String(actor.id);
  if (item.status !== "PENDING_APPROVAL" ||
      [String(item.createdBy), String(item.submittedBy)].includes(actorId) ||
      (item.approvals || []).some(approval => String(approval.actorId) === actorId)) return false;
  const step = item.approvalSnapshot?.steps?.[(item.approvals || []).length];
  return !!step && (step.userIds.map(String).includes(actorId) ||
    (actor.roleId && step.roleIds.map(String).includes(String(actor.roleId))));
}
function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail("The current expense revision is required.");
  return value;
}
function filters(input = {}) {
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const from = date(input.from || `${today.slice(0, 7)}-01`, "Start date");
  const to = date(input.to || today, "End date");
  if (from > to || new Date(to) - new Date(from) > 3660 * 86400000) throw fail("Select a valid date range of ten years or less.");
  const result = { expenseDate: { $gte: from, $lte: to } };
  if (input.status) {
    if (!STATES.includes(input.status)) throw fail("Invalid expense status.");
    result.status = input.status;
  }
  if (input.categoryId) result.categoryId = id(input.categoryId, "Category");
  if (input.vendorId) result.vendorId = id(input.vendorId, "Vendor");
  if (input.department) result.department = text(input.department, "Department", 120);
  if (input.branch) result.branch = text(input.branch, "Branch", 120);
  return result;
}
module.exports = { PERMISSIONS, STATES, PAYMENT_METHODS, fail, text, id, ids, amountMinor,
  date, normalizedKey, canonical, hash, requestKey, expense, approvalSteps, canApprove, expectedVersion, filters };
