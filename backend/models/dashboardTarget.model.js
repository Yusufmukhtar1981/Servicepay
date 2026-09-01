const mongoose = require("mongoose");

const dashboardTargetSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, enum: ["executive"] },
  values: { type: Map, of: Number, default: {} },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
}, { timestamps: true });

module.exports = mongoose.model("DashboardTarget", dashboardTargetSchema);