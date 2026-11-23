"use strict";

const mongoose = require("mongoose");
const { STATES, PAYMENT_METHODS } = require("../services/expenseManagement.rules");
const { Schema } = mongoose;
const options = collection => ({ collection, timestamps: true, autoCreate: false, autoIndex: false });
const money = { type: Number, required: true, min: 1, validate: Number.isSafeInteger };
const ref = model => ({ type: Schema.Types.ObjectId, ref: model });
const approvalStep = new Schema({
  label: { type: String, required: true },
  userIds: [Schema.Types.ObjectId],
  roleIds: [Schema.Types.ObjectId],
}, { _id: false });
const expenseSchema = new Schema({
  title: { type: String, required: true, maxlength: 180 },
  categoryId: { ...ref("CompanyExpenseRegistry"), required: true },
  categoryName: { type: String, required: true },
  description: { type: String, required: true, maxlength: 4000 },
  businessPurpose: { type: String, required: true, maxlength: 2000 },
  amountMinor: money,
  currency: { type: String, enum: ["NGN"], default: "NGN", immutable: true },
  expenseDate: { type: String, required: true },
  paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
  vendorId: ref("CompanyExpenseRegistry"),
  vendorName: String,
  beneficiary: String,
  reference: { type: String, required: true },
  department: String,
  branch: String,
  documentIds: [{ type: Schema.Types.ObjectId, ref: "CompanyExpenseDocument" }],
  evidenceException: {
    reason: String, authorizedBy: ref("User"), authorizedAt: Date,
  },
  status: { type: String, enum: STATES, required: true, default: "SUBMITTED" },
  createdBy: { ...ref("User"), required: true, immutable: true },
  createdByName: String,
  submittedBy: ref("User"),
  submittedAt: Date,
  approvalSnapshot: { policyVersion: Number, steps: [approvalStep] },
  approvals: [{
    _id: false, step: Number, label: String, actorId: ref("User"),
    actorName: String, actorRoleId: Schema.Types.ObjectId, at: Date, comments: String,
  }],
  rejection: { actorId: ref("User"), at: Date, reason: String },
  payment: {
    recordedBy: ref("User"), recordedAt: Date, paidDate: String, method: String,
    reference: String, comments: String, evidenceDocumentIds: [Schema.Types.ObjectId],
    attestation: { type: String, enum: ["MANUAL_COMPANY_PAYMENT_RECORD"] },
  },
  reversal: {
    recordedBy: ref("User"), recordedAt: Date, date: String, reference: String,
    reason: String, evidenceDocumentIds: [Schema.Types.ObjectId],
    attestation: { type: String, enum: ["MANUAL_COMPANY_REVERSAL_RECORD"] },
  },
  cancellation: { actorId: ref("User"), at: Date, reason: String },
  requestKey: { type: String, required: true, immutable: true },
  requestHash: { type: String, required: true, immutable: true },
  dedupKey: { type: String, required: true },
  revision: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  lastAuditHash: { type: String, required: true },
}, options("companyexpenses"));
expenseSchema.index({ requestKey: 1 }, { unique: true, name: "company_expense_request_unique" });
expenseSchema.index({ dedupKey: 1 }, { unique: true, name: "company_expense_invoice_unique" });
expenseSchema.index({ expenseDate: -1, status: 1 }, { name: "company_expense_period_status" });
expenseSchema.index({ categoryId: 1, expenseDate: -1 }, { name: "company_expense_category_period" });
expenseSchema.index({ vendorId: 1, expenseDate: -1 }, { name: "company_expense_vendor_period" });

const registrySchema = new Schema({
  kind: { type: String, enum: ["CATEGORY", "VENDOR", "POLICY"], required: true, immutable: true },
  key: { type: String, required: true },
  name: { type: String, required: true },
  description: String,
  contactName: String, email: String, phone: String, address: String,
  active: { type: Boolean, default: true },
  approvalSteps: [approvalStep],
  createdBy: { ...ref("User"), required: true, immutable: true },
  updatedBy: { ...ref("User"), required: true },
  revision: { type: Number, required: true, default: 0, min: 0 },
  lastAuditHash: { type: String, required: true },
}, options("companyexpenseregistry"));
registrySchema.index({ kind: 1, key: 1 }, { unique: true, name: "company_expense_registry_unique" });

const eventSchema = new Schema({
  subjectType: { type: String, enum: ["EXPENSE", "REGISTRY", "DOCUMENT", "REPORT"], required: true },
  subjectId: { type: String, required: true },
  version: { type: Number, min: 0 },
  action: { type: String, required: true },
  actorId: { ...ref("User"), required: true },
  actorRole: String,
  actorName: String,
  reason: { type: String, required: true },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  at: { type: Date, required: true },
  previousHash: { type: String, required: true },
  eventHash: { type: String, required: true },
  requestKey: String,
  requestHash: String,
}, { ...options("companyexpenseevents"), timestamps: false });
eventSchema.index({ subjectType: 1, subjectId: 1, version: 1 }, {
  unique: true, name: "company_expense_event_version_unique",
  partialFilterExpression: { version: { $type: "number" } },
});
eventSchema.index({ requestKey: 1 }, {
  unique: true, name: "company_expense_event_request_unique",
  partialFilterExpression: { requestKey: { $type: "string" } },
});
eventSchema.index({ subjectType: 1, subjectId: 1, at: 1 }, { name: "company_expense_event_history" });
eventSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Expense audit records are immutable.");
});
eventSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne",
  "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"], async function () {
  throw new Error("Expense audit records are immutable.");
});

const documentSchema = new Schema({
  uploadedBy: { ...ref("User"), required: true, immutable: true },
  expenseId: ref("CompanyExpense"),
  name: { type: String, required: true },
  mimeType: { type: String, required: true, enum: ["image/jpeg", "image/png", "application/pdf"] },
  size: { type: Number, required: true, min: 1 },
  sha256: { type: String, required: true, immutable: true },
  storageKey: { type: String, required: true, immutable: true },
  state: { type: String, enum: ["UPLOADING", "READY", "ATTACHED", "UNCONFIRMED"], required: true },
  uploadRequestKey: { type: String, required: true, immutable: true },
  errorCategory: String,
}, options("companyexpensedocuments"));
documentSchema.index({ uploadRequestKey: 1 }, { unique: true, name: "company_expense_document_request_unique" });
documentSchema.index({ expenseId: 1 }, { name: "company_expense_document_owner" });
documentSchema.index({ uploadedBy: 1, createdAt: -1 }, { name: "company_expense_document_upload_window" });

for (const schema of [expenseSchema, registrySchema, documentSchema]) {
  schema.pre(["deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"], async function () {
    throw new Error("Financial expense records cannot be permanently deleted. Use an audited cancellation or reversal.");
  });
}

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
module.exports = {
  Expense: model("CompanyExpense", expenseSchema),
  Registry: model("CompanyExpenseRegistry", registrySchema),
  Event: model("CompanyExpenseEvent", eventSchema),
  Document: model("CompanyExpenseDocument", documentSchema),
};
