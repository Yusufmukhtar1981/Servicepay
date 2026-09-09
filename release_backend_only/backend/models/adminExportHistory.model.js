const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  dataset: { type: String, required: true, trim: true, uppercase: true, index: true },
  rowCount: { type: Number, required: true, min: 0, max: 5000 },
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  columns: { type: [String], default: [] },
  status: { type: String, enum: ["COMPLETED", "FAILED"], default: "COMPLETED", index: true },
  completedAt: { type: Date, default: Date.now },
  contentAvailable: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ createdAt: -1 });
module.exports = mongoose.model("AdminExportHistory", schema);