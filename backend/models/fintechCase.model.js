const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema({
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const fintechCaseSchema = new mongoose.Schema({
  caseReference: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  type: { type: String, required: true, enum: ["COMPLAINT", "CHARGEBACK", "MANUAL_RESOLUTION"], index: true },
  status: { type: String, enum: ["OPEN", "IN_REVIEW", "WAITING_ON_CUSTOMER", "RESOLVED", "REJECTED", "CLOSED"], default: "OPEN", index: true },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  resolution: { type: String, trim: true, maxlength: 3000, default: "" },
  notes: { type: [noteSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

fintechCaseSchema.index({ type: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model("FintechCase", fintechCaseSchema);