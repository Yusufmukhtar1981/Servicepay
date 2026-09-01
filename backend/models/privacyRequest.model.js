const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  note: { type: String, trim: true, maxlength: 1000, default: "" },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

const schema = new mongoose.Schema({
  subjectUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["ACCESS", "ERASURE", "CORRECTION", "OBJECTION"], required: true },
  status: { type: String, enum: ["OPEN", "IN_REVIEW", "COMPLETED", "REJECTED"], default: "OPEN", index: true },
  description: { type: String, trim: true, maxlength: 2000, default: "" },
  history: { type: [historySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
schema.index({ status: 1, createdAt: -1 });
schema.index({ createdAt: -1 });
module.exports = mongoose.model("PrivacyRequest", schema);