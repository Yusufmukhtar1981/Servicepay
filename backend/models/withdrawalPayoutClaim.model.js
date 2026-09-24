const mongoose = require("mongoose");

const withdrawalPayoutClaimSchema = new mongoose.Schema(
  {
    payoutReference: { type: String, required: true, unique: true, trim: true },
    withdrawalId: { type: mongoose.Schema.Types.ObjectId, ref: "WithdrawalRequest", required: true, unique: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WithdrawalPayoutClaim", withdrawalPayoutClaimSchema);