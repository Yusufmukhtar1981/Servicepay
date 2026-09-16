const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlementAccount", required: true, immutable: true, index: true },
  provider: { type: String, required: true, immutable: true },
  bankCode: { type: String, required: true, immutable: true },
  maskedAccount: { type: String, required: true, immutable: true },
  canonicalAccountName: { type: String, required: true, immutable: true },
  responseDigest: { type: String, required: true, immutable: true },
  providerReference: { type: String, default: null, immutable: true },
  verifiedAt: { type: Date, default: Date.now, immutable: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  verificationVersion: { type: Number, required: true, immutable: true },
});
schema.index({ account: 1, verificationVersion: 1 }, { unique: true });
module.exports = mongoose.model("EduPayAccountVerificationEvidence", schema);