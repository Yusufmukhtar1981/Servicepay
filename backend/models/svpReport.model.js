const mongoose = require("mongoose");

const svpReportSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "INCIDENT", "OPERATIONAL", "FINANCIAL_PERFORMANCE", "BRANCH_PERFORMANCE", "STAFF_PERFORMANCE"], index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  summary: { type: String, trim: true, maxlength: 5000, default: "" },
  status: { type: String, enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACKNOWLEDGED", "ACTION_REQUIRED", "RESOLVED", "CLOSED"], default: "DRAFT", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scope: { type: mongoose.Schema.Types.Mixed, required: true },
  headOfficeComments: [{ comment: { type: String, required: true, trim: true, maxlength: 2000 }, authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, createdAt: { type: Date, default: Date.now } }],
  history: [{ status: String, note: String, actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: { type: Date, default: Date.now } }],
}, { timestamps: true });
svpReportSchema.index({ createdBy: 1, createdAt: -1 });
module.exports = mongoose.model("SVPReport", svpReportSchema);