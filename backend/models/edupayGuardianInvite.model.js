const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true, index: true },
  codeHash: { type: String, required: true, unique: true, immutable: true, select: false },
  expiresAt: { type: Date, required: true, index: true, immutable: true },
  status: { type: String, enum: ["PENDING", "CONSUMED", "REVOKED", "EXPIRED"], default: "PENDING", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  consumedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  consumedAt: { type: Date, default: null, immutable: true },
}, { timestamps: true });
schema.index({ school: 1, child: 1, status: 1 });
module.exports = mongoose.model("EduPayGuardianInvite", schema);