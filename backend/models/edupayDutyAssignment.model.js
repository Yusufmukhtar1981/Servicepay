const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  permissions: [{ type: String, enum: ["account.manage", "account.verify", "settlement.process"], immutable: true }],
  active: { type: Boolean, default: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  version: { type: Number, required: true, immutable: true },
  previousAssignment: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayDutyAssignment", default: null, immutable: true },
}, { mutablePaths: [], versionKey: "documentVersion" });
schema.index({ user: 1, version: 1 }, { unique: true });
schema.index({ user: 1, version: -1 });
module.exports = mongoose.model("EduPayDutyAssignment", schema);