const mongoose = require("mongoose");

const riskRuleSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  version: { type: Number, required: true, min: 1, default: 1 },
  enabled: { type: Boolean, default: true, index: true },
  score: { type: Number, required: true, min: 0, max: 100 },
  configuration: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true, optimisticConcurrency: true });
riskRuleSchema.index({ enabled: 1, code: 1 });
module.exports = mongoose.model("RiskRule", riskRuleSchema);