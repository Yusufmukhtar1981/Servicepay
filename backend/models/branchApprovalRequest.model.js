const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  type: { type: String, required: true, trim: true, uppercase: true },
  requestKey: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["DRAFT", "SUBMITTED", "PENDING_HEAD_OFFICE", "APPROVED", "REJECTED", "CORRECTION_REQUESTED", "CANCELLED", "COMPLETED"], default: "DRAFT", index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, trim: true, default: "" },
}, { timestamps: true });
schema.index({ branchId: 1, status: 1, createdAt: -1 });
schema.index({ branchId: 1, requestKey: 1 }, { unique: true });
module.exports = mongoose.model("BranchApprovalRequest", schema);