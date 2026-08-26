const mongoose = require("mongoose");
const solarRecoveryCaseSchema = new mongoose.Schema({
  finance: { type: mongoose.Schema.Types.ObjectId, ref: "SolarFinance", required: true, index: true },
  application: { type: mongoose.Schema.Types.ObjectId, ref: "SolarApplication", required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  notes: { type: String, trim: true, default: "", maxlength: 3000 },
  contactAttempts: { type: [{ at: Date, channel: String, outcome: String, note: String }], default: [] },
  status: { type: String, enum: ["OPEN", "RECOVERED", "CLOSED"], default: "OPEN" },
  openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
module.exports = mongoose.model("SolarRecoveryCase", solarRecoveryCaseSchema);