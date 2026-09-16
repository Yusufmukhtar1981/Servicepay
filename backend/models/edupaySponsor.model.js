const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const inviteSchema = immutableSchema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true, index: true },
  tokenHash: { type: String, required: true, unique: true, immutable: true },
  sponsorName: { type: String, trim: true, maxlength: 160, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
  status: { type: String, enum: ["ACTIVE", "EXPIRED", "REVOKED"], default: "ACTIVE", index: true },
});
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const contributionSchema = immutableSchema({
  invite: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySponsorInvite", required: true, immutable: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true },
  sponsorName: { type: String, trim: true, maxlength: 160, immutable: true },
  amount: { ...money(0), required: true, min: 0.01, immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  status: { type: String, enum: ["SUCCESS", "FAILED", "REVERSED"], default: "SUCCESS", immutable: true },
});
module.exports = {
  EduPaySponsorInvite: mongoose.model("EduPaySponsorInvite", inviteSchema),
  EduPaySponsorContribution: mongoose.model("EduPaySponsorContribution", contributionSchema),
};