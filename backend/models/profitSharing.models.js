"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;
const options = { timestamps: true, autoCreate: false, autoIndex: false, strict: "throw" };
const money = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
// Deterministic _id is the only uniqueness key. Storage must be provisioned
// explicitly; importing this module never creates collections or indexes.
const admission = new Schema({
  _id: { type: String, required: true },
  transaction: { type: Schema.Types.ObjectId, required: true },
  reference: { type: String, required: true },
  serviceType: { type: String, required: true },
  amountKobo: money,
  rule: { type: Schema.Types.Mixed, required: true },
  beneficiaries: { type: Schema.Types.Mixed, required: true },
  adapterVersion: { type: String, required: true },
  admittedAt: { type: Date, required: true },
  activationId: { type: String, required: true },
}, options);
admission.pre("validate", function () {
  if (!this.isNew) return;
  const policy = require("../services/profitSharing.policy");
  policy.validateDistributionRule(this.rule);
  if (!this.beneficiaries || Object.keys(this.beneficiaries).length !== policy.ROLES.length ||
      Object.keys(this.beneficiaries).some(role => !policy.ROLES.includes(role))) {
    throw new Error("Only the four configured company-profit beneficiaries may be admitted.");
  }
});
const event = new Schema({
  _id: { type: String, required: true },
  transaction: { type: Schema.Types.ObjectId },
  kind: { type: String, enum: ["ACCRUAL", "REVERSAL", "DRY_RUN", "BLOCKED", "PROVIDER_DEBIT_EVIDENCE",
    "WITHDRAWAL_RESERVED", "WITHDRAWAL_PAID", "WITHDRAWAL_RELEASED",
    "VERIFIED_COMPANY_PROFIT", "COMPANY_ZERO_PROFIT"], required: true },
  admissionId: String,
  originalEventId: String,
  data: { type: Schema.Types.Mixed, required: true },
}, options);
const account = new Schema({
  _id: { type: String, required: true },
  availableKobo: { ...money, default: 0 },
  reservedKobo: { ...money, default: 0 },
  withdrawnKobo: { ...money, default: 0 },
  earnedKobo: { ...money, default: 0 },
  reversedKobo: { ...money, default: 0 },
  recoveryDebtKobo: { ...money, default: 0 },
  revision: { ...money, default: 0 },
}, options);
for (const schema of [admission, event]) {
  schema.pre("save", function () {
    if (!this.isNew) throw new Error("Profit sharing history is append-only.");
  });
  for (const operation of ["updateOne", "updateMany", "replaceOne", "findOneAndUpdate",
    "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]) {
    schema.pre(operation, function () { throw new Error("Profit sharing history is append-only."); });
  }
}
const model = (name, schema, collection) => mongoose.models[name] || mongoose.model(name, schema, collection);
module.exports = {
  Admission: model("ProfitSharingAdmission", admission, "profitsharingadmissions"),
  Event: model("ProfitSharingEvent", event, "profitsharingevents"),
  Account: model("ProfitSharingAccount", account, "profitsharingaccounts"),
};
