const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, immutable: true, index: true },
    referredCustomer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourceType: { type: String, required: true, immutable: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    operation: { type: String, enum: ["AWARD", "CLAWBACK", "RECONCILE"], required: true, immutable: true },
    status: { type: String, enum: ["PENDING", "RESOLVED"], default: "PENDING", index: true },
    lastError: { type: String, default: "", maxlength: 1000 },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseId: { type: String, default: "", index: true },
    leaseUntil: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false }
);

schema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model("ReferralRewardReconciliation", schema);