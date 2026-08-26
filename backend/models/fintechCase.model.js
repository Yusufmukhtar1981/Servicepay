const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema({
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  idempotencyKey: { type: String, trim: true, maxlength: 120 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const replySchema = new mongoose.Schema({
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  authorName: { type: String, trim: true, maxlength: 200, default: "" },
  authorRole: { type: String, trim: true, uppercase: true, maxlength: 50, required: true },
  idempotencyKey: { type: String, trim: true, maxlength: 120 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const fintechCaseSchema = new mongoose.Schema({
  caseReference: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  type: { type: String, required: true, enum: ["COMPLAINT", "CHARGEBACK", "MANUAL_RESOLUTION"], index: true },
  // IN_REVIEW, WAITING_ON_CUSTOMER and REJECTED are retained for existing
  // operational cases. IN_PROGRESS is the customer-support workflow value.
  status: { type: String, enum: ["OPEN", "IN_PROGRESS", "IN_REVIEW", "WAITING_ON_CUSTOMER", "RESOLVED", "REJECTED", "CLOSED"], default: "OPEN", index: true },
  priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL", index: true },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  resolution: { type: String, trim: true, maxlength: 3000, default: "" },
  notes: { type: [noteSchema], default: [] },
  publicReplies: { type: [replySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

fintechCaseSchema.index({ type: 1, status: 1, createdAt: -1 });
fintechCaseSchema.index({ customer: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model("FintechCase", fintechCaseSchema);