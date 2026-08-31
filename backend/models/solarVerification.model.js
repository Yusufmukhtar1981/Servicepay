const mongoose = require("mongoose");

const solarVerificationSchema = new mongoose.Schema(
  {
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SolarApplication",
      required: true,
      unique: true,
      index: true,
    },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    officer: { type: mongoose.Schema.Types.ObjectId, ref: "SolarOfficer", required: true, index: true },
    checklist: {
      identityConfirmed: { type: Boolean, default: false },
      phoneConfirmed: { type: Boolean, default: false },
      addressConfirmed: { type: Boolean, default: false },
      locationConfirmed: { type: Boolean, default: false },
      customerContacted: { type: Boolean, default: false },
      requirementConfirmed: { type: Boolean, default: false },
      repaymentAssessed: { type: Boolean, default: false },
      kycReviewed: { type: Boolean, default: false },
    },
    notes: { type: String, trim: true, default: "", maxlength: 3000 },
    fieldVisitNotes: { type: String, trim: true, default: "", maxlength: 3000 },
    evidenceUrls: { type: [String], default: [] },
    verifiedAt: { type: Date, default: Date.now },
    recommendation: {
      type: String,
      enum: ["VERIFIED_RECOMMENDED", "NOT_RECOMMENDED", "NEEDS_REVIEW"],
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SolarVerification", solarVerificationSchema);