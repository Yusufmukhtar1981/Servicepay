const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, immutable: true },
  permissions: [{ type: String, enum: ["account.manage", "account.verify", "settlement.process"], immutable: true }],
  active: { type: Boolean, default: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { mutablePaths: ["active"] });
schema.index({ user: 1, active: 1 });
module.exports = mongoose.model("EduPayDutyAssignment", schema);