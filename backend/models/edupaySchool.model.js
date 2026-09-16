const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 180 },
  schoolType: { type: String, trim: true, maxlength: 80 },
  registrationNumber: { type: String, trim: true, maxlength: 120 },
  address: { type: String, required: true, trim: true, maxlength: 500 },
  state: { type: String, required: true, trim: true, maxlength: 80 },
  lga: { type: String, trim: true, maxlength: 80 },
  contactPerson: { type: String, trim: true, maxlength: 160 },
  phone: { type: String, trim: true, maxlength: 40 },
  email: { type: String, trim: true, lowercase: true, maxlength: 180 },
  // Application banking is onboarding evidence only. It is never a payout
  // account until the separate settlement-account verification flow succeeds.
  bankDetails: { accountName: String, encryptedAccountNumber: { type: String, select: false }, accountNumberLast4: String, bankName: String, bankCode: String },
  logo: { type: mongoose.Schema.Types.Mixed, default: null },
  supportingDocuments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  authorizedRepresentative: { type: String, trim: true, maxlength: 180 },
  status: { type: String, enum: ["PENDING", "PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"], default: "PENDING_REVIEW", index: true },
  active: { type: Boolean, default: false, index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, maxlength: 1000 },
  portalUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  normalizedRegistrationNumber: { type: String, default: null, immutable: true },
  normalizedEmail: { type: String, default: null, immutable: true },
  normalizedPhone: { type: String, default: null, immutable: true },
  currentSettlementAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlementAccount", default: null },
  currentSettlementAccountVersion: { type: Number, default: null },
  edupayPayoutLock: { settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", default: null }, acquiredAt: { type: Date, default: null } },
}, { timestamps: true });
schema.index({ registrationNumber: 1 });
schema.index({ status: 1, active: 1 });
schema.index({ normalizedRegistrationNumber: 1 }, { unique: true, partialFilterExpression: { normalizedRegistrationNumber: { $type: "string" }, status: { $in: ["PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "SUSPENDED"] } } });
schema.index({ normalizedEmail: 1 }, { unique: true, partialFilterExpression: { normalizedEmail: { $type: "string" }, status: { $in: ["PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "SUSPENDED"] } } });
schema.index({ normalizedPhone: 1 }, { unique: true, partialFilterExpression: { normalizedPhone: { $type: "string" }, status: { $in: ["PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "SUSPENDED"] } } });
module.exports = mongoose.model("EduPaySchool", schema);