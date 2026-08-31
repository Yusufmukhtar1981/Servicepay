const mongoose = require("mongoose");
const branchTargetSchema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  module: { type: String, required: true, trim: true, uppercase: true },
  metric: { type: String, required: true, trim: true, uppercase: true },
  period: { type: String, required: true, trim: true },
  periodType: { type: String, required: true, enum: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  category: { type: String, required: true, trim: true, uppercase: true },
  target: { type: Number, required: true, min: 0 },
  actual: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["ON_TRACK", "BEHIND_TARGET", "ACHIEVED", "EXCEEDED_TARGET"], default: "BEHIND_TARGET", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
branchTargetSchema.index({ branchId: 1, category: 1, periodType: 1, startDate: 1, endDate: 1 }, { unique: true });
branchTargetSchema.methods.refreshStatus = function () {
  const ratio = this.target > 0 ? this.actual / this.target : 0;
  this.status = ratio > 1 ? "EXCEEDED_TARGET" : ratio === 1 ? "ACHIEVED" : ratio >= .75 ? "ON_TRACK" : "BEHIND_TARGET";
  return this.status;
};
branchTargetSchema.pre("save", function () { if (this.isModified("actual") || this.isModified("target")) this.refreshStatus(); });
branchTargetSchema.virtual("remaining").get(function () { return Math.max(0, this.target - this.actual); });
branchTargetSchema.virtual("percentage").get(function () { return this.target ? (this.actual / this.target) * 100 : 0; });
branchTargetSchema.set("toJSON", { virtuals: true });
module.exports = mongoose.model("BranchTarget", branchTargetSchema);