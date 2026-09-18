const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  child: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayChild", required: true, immutable: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  relationship: { type: String, trim: true, maxlength: 40, default: "GUARDIAN" },
  status: { type: String, enum: ["PENDING", "VERIFIED", "REVOKED"], default: "PENDING", index: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ school: 1, child: 1, parent: 1 }, { unique: true });
module.exports = mongoose.model("EduPayGuardianLink", schema);