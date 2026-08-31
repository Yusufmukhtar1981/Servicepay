const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  type: { type: String, required: true, trim: true, uppercase: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: "" },
  status: { type: String, enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"], default: "OPEN", index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ branchId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model("BranchOperationalRequest", schema);