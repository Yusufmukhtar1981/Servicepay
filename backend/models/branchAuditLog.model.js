const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, required: true, trim: true, uppercase: true, index: true },
  reason: { type: String, required: true, trim: true },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
schema.index({ branchId: 1, createdAt: -1 });
module.exports = mongoose.model("BranchAuditLog", schema);