"use strict";
const mongoose = require("mongoose");
const { randomBytes } = require("node:crypto");
const { Schema } = mongoose;
const oid = { type: Schema.Types.ObjectId, ref: "User", required: true };
const options = { timestamps: true, autoCreate: false, autoIndex: false, strict: "throw" };
const model = (name, schema, collection) => mongoose.models[name] || mongoose.model(name, schema, collection);
const profileSchema = new Schema({
  owner: oid,
  kind: { type: String, enum: ["AGENT", "MERCHANT"], required: true },
  networkId: { type: String, required: true, default: () => `SPN-${randomBytes(8).toString("hex").toUpperCase()}` },
  status: { type: String, enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"], default: "DRAFT" },
  revision: { type: Number, default: 0 },
  details: {
    businessName: String, businessCategory: String, ownerName: String,
    phone: String, email: String, state: String, lga: String, address: String,
    description: String, registrationNumber: String, preferredServices: [String],
  },
  feedback: { type: String, default: "" },
  services: [String],
  group: { type: String, default: "STANDARD" },
  approvedAt: Date,
  approvalWindows: [{ _id: false, start: { type: Date, required: true }, end: Date, services: [String], group: String }],
}, options);
profileSchema.index({ owner: 1, kind: 1 }, { unique: true });
profileSchema.index({ networkId: 1 }, { unique: true });
profileSchema.index({ kind: 1, status: 1, createdAt: -1 });
const branchSchema = new Schema({
  profile: { type: Schema.Types.ObjectId, ref: "NetworkProfile", required: true },
  name: { type: String, required: true }, address: { type: String, required: true },
  accessVersion: { type: Number, default: 0 },
  status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE" },
}, options);
branchSchema.index({ profile: 1, name: 1 }, { unique: true });
const staffSchema = new Schema({
  profile: { type: Schema.Types.ObjectId, ref: "NetworkProfile", required: true },
  user: oid,
  branch: { type: Schema.Types.ObjectId, ref: "NetworkBranch", required: true },
  permissions: [{ type: String, enum: ["reports", "payments"] }],
  status: { type: String, enum: ["INVITED", "ACTIVE", "SUSPENDED"], default: "INVITED" },
}, options);
staffSchema.index({ profile: 1, user: 1 }, { unique: true });
staffSchema.index({ user: 1, status: 1 });
const activitySchema = new Schema({
  profile: { type: Schema.Types.ObjectId, ref: "NetworkProfile", required: true },
  transaction: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
  actor: oid,
  branch: { type: Schema.Types.ObjectId, ref: "NetworkBranch" },
  consent: { acknowledged: { type: Boolean, required: true }, acknowledgedAt: { type: Date, required: true } },
  commissionGroup: { type: String, required: true, default: "STANDARD" },
}, options);
activitySchema.index({ transaction: 1 }, { unique: true });
activitySchema.index({ profile: 1, createdAt: -1 });
const ruleSchema = new Schema({
  service: { type: String, required: true },
  group: { type: String, default: "STANDARD" }, state: { type: String, default: "" }, lga: { type: String, default: "" },
  mode: { type: String, enum: ["FIXED", "PERCENT"], required: true },
  value: { type: Number, required: true, min: 0 },
  minAmountKobo: { type: Number, default: 0 },
  maxAmountKobo: { type: Number, default: null },
  enabled: { type: Boolean, default: true },
  disabledAt: Date,
  createdBy: oid,
}, options);
ruleSchema.index({ service: 1, group: 1, enabled: 1 });
const ledgerSchema = new Schema({
  eventKey: { type: String, required: true },
  profile: { type: Schema.Types.ObjectId, ref: "NetworkProfile", required: true },
  transaction: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
  rule: { type: Schema.Types.ObjectId, ref: "NetworkCommissionRule" },
  event: { type: String, enum: ["ACCRUAL", "REVERSAL", "SETTLEMENT"], required: true },
  amountKobo: { type: Number, required: true },
  evidence: {
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    reference: String, paidAt: Date, reason: String, confirmation: Boolean,
    providerVerified: { type: Boolean, default: false },
  },
}, options);
ledgerSchema.index({ eventKey: 1 }, { unique: true });
ledgerSchema.index({ profile: 1, createdAt: -1 });
const auditSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: "User" }, action: { type: String, required: true },
  profile: { type: Schema.Types.ObjectId, ref: "NetworkProfile" },
  reason: { type: String, default: "" },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, options);
auditSchema.index({ profile: 1, createdAt: -1 });
const settingsSchema = new Schema({
  _id: { type: String, default: "network" },
  categories: { type: [String], default: ["Retail", "Food and hospitality", "Professional services", "Other"] },
}, options);
const settlementSchema = new Schema({
  reference: { type: String, required: true },
  profile: { type: Schema.Types.ObjectId, ref: "NetworkProfile", required: true },
  commissionIds: [{ type: Schema.Types.ObjectId, ref: "NetworkCommissionLedger" }],
  amountKobo: { type: Number, required: true }, paidAt: { type: Date, required: true },
  actor: oid, reason: { type: String, required: true },
  providerVerified: { type: Boolean, default: false },
}, options);
settlementSchema.index({ reference: 1 }, { unique: true });
for (const schema of [ledgerSchema, auditSchema, settlementSchema]) {
  schema.pre("save", function () { if (!this.isNew) throw new Error("Network accounting and audit history is append-only."); });
  for (const operation of ["updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"])
    schema.pre(operation, function () { throw new Error("Network accounting and audit history is append-only."); });
}
module.exports = {
  Profile: model("NetworkProfile", profileSchema, "networkprofiles"),
  Branch: model("NetworkBranch", branchSchema, "networkbranches"),
  Staff: model("NetworkStaff", staffSchema, "networkstaff"),
  Activity: model("NetworkActivity", activitySchema, "networkactivities"),
  Rule: model("NetworkCommissionRule", ruleSchema, "networkcommissionrules"),
  Ledger: model("NetworkCommissionLedger", ledgerSchema, "networkcommissionledger"),
  Audit: model("NetworkAudit", auditSchema, "networkaudit"),
  Settings: model("NetworkSettings", settingsSchema, "networksettings"),
  Settlement: model("NetworkSettlement", settlementSchema, "networksettlements"),
};
