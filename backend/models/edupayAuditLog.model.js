const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  action: { type: String, required: true, immutable: true, index: true },
  entityType: { type: String, required: true, immutable: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", default: null, immutable: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  ip: { type: String, default: null, immutable: true },
}, { mutablePaths: [] });
schema.index({ createdAt: -1 });
module.exports = mongoose.model("EduPayAuditLog", schema);