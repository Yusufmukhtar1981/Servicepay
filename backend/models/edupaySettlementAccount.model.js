const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  accountName: { type: String, required: true, trim: true, immutable: true },
  canonicalAccountName: { type: String, default: null },
  bankName: { type: String, required: true, trim: true, immutable: true },
  bankCode: { type: String, required: true, trim: true, immutable: true },
  encryptedAccountNumber: { type: String, required: true, select: false, immutable: true },
  accountNumberLast4: { type: String, required: true, immutable: true },
  verified: { type: Boolean, default: false, index: true },
  active: { type: Boolean, default: false, index: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  version: { type: Number, required: true, immutable: true },
  previousVersion: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlementAccount", default: null, immutable: true },
}, { timestamps: true });
schema.index({ school: 1, version: 1 }, { unique: true });
module.exports = mongoose.model("EduPaySettlementAccount", schema);