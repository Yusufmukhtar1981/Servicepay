const mongoose = require("mongoose");

const solarPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: "", maxlength: 4000 },
    capacityKw: { type: Number, required: true, min: 0.01 },
    cashPrice: { type: Number, required: true, min: 0 },
    financedPrice: { type: Number, default: null, min: 0 },
    depositPercent: { type: Number, required: true, default: 20, min: 0, max: 100 },
    installmentMonths: { type: Number, required: true, default: 12, min: 1, max: 120 },
    interestPercent: { type: Number, default: 0, min: 0, max: 100 },
    terms: { type: mongoose.Schema.Types.Mixed, default: {} },
    repaymentFrequency: { type: String, enum: ["WEEKLY", "BIWEEKLY", "MONTHLY"], default: "MONTHLY" },
    images: { type: [String], default: [] },
    specifications: { type: mongoose.Schema.Types.Mixed, default: {} },
    warranty: { type: mongoose.Schema.Types.Mixed, default: {} },
    installmentIncluded: { type: Boolean, default: true },
    minimumKycTier: { type: String, default: "" },
    eligibilityNotes: { type: String, default: "" },
    termsSummary: { type: String, default: "" },
    stock: { type: Number, required: true, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);
solarPackageSchema.index({ active: 1, name: 1 });
module.exports = mongoose.model("SolarPackage", solarPackageSchema);