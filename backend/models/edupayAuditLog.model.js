const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true, index: true },
  actorType: { type: String, enum: ["USER", "PROVIDER", "SYSTEM"], default: "USER", immutable: true },
  actorLabel: { type: String, default: null, immutable: true },
  action: { type: String, required: true, immutable: true, index: true },
  entityType: { type: String, required: true, immutable: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", default: null, immutable: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  ip: { type: String, default: null, immutable: true },
}, { mutablePaths: [] });
schema.index({ createdAt: -1 });
schema.pre("validate", function () { if (this.actorType === "USER" && !this.actor) throw new Error("USER EduPay audit records require an actor."); if (this.actorType !== "USER" && !this.actorLabel) throw new Error("Provider/system EduPay audit records require actorLabel."); });
module.exports = mongoose.model("EduPayAuditLog", schema);