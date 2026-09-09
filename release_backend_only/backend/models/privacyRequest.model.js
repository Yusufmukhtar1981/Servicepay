const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  note: { type: String, trim: true, maxlength: 1000, default: "" },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actorType: { type: String, enum: ["PUBLIC", "ADMIN", "SYSTEM"], default: "ADMIN" },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

const schema = new mongoose.Schema({
  subjectUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  type: { type: String, enum: ["ACCESS", "ERASURE", "CORRECTION", "OBJECTION", "ACCOUNT_DELETION", "DATA_REQUEST"], required: true },
  requestKind: { type: String, enum: ["ACCOUNT_DELETION", "DATA_REQUEST"], default: null, index: true },
  dataRequestType: { type: String, enum: ["ACCESS", "CORRECTION", "PORTABILITY", "OBJECTION", "OTHER"], default: null },
  status: { type: String, enum: ["OPEN", "IN_REVIEW", "PENDING", "UNDER_REVIEW", "APPROVED", "COMPLETED", "REJECTED"], default: "OPEN", index: true },
  description: { type: String, trim: true, maxlength: 2000, default: "" },
  requester: {
    fullName: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  },
  confirmationAccepted: { type: Boolean, default: false },
  referenceId: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },
  activeRequestKey: { type: String, trim: true, unique: true, sparse: true, index: true },
  submittedAt: { type: Date, default: Date.now, index: true },
  history: { type: [historySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
schema.index({ status: 1, createdAt: -1 });
schema.index({ createdAt: -1 });
module.exports = mongoose.model("PrivacyRequest", schema);