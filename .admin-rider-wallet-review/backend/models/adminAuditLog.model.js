const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, required: true, maxlength: 100 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

adminAuditLogSchema.index({ createdAt: -1 });
module.exports = mongoose.model("AdminAuditLog", adminAuditLogSchema);