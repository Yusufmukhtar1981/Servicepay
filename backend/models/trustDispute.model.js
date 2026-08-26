const mongoose = require("mongoose");

const trustDisputeSchema = new mongoose.Schema({
  deal: { type: mongoose.Schema.Types.ObjectId, ref: "ProtectedDeal", required: true, unique: true, index: true },
  openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 1500 },
  description: { type: String, default: "", trim: true, maxlength: 3000 },
  evidenceReferences: { type: [String], default: [], validate: [(items) => items.length <= 10, "Too many evidence references."] },
  status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN", index: true },
  resolution: { type: String, enum: ["", "RELEASE", "REFUND"], default: "" },
  resolutionNote: { type: String, default: "", trim: true, maxlength: 1500 },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  resolvedAt: { type: Date, default: null },
  idempotencyKey: { type: String, required: true, unique: true, trim: true },
}, { timestamps: true });

trustDisputeSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.models.TrustDispute || mongoose.model("TrustDispute", trustDisputeSchema);