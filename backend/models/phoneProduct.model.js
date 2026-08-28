const mongoose = require("mongoose");

const phoneProductSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  brand: { type: String, trim: true, maxlength: 80, default: "" },
  description: { type: String, trim: true, maxlength: 4000, default: "" },
  cashPrice: { type: Number, required: true, min: 0 },
  financedPrice: { type: Number, required: true, min: 0 },
  depositPercent: { type: Number, required: true, min: 0, max: 100 },
  interestPercent: { type: Number, default: 0, min: 0, max: 100 },
  weeklyInstallments: { type: Number, required: true, min: 1, max: 260 },
  durationOptionsWeeks: { type: [Number], default: [] },
  minimumKycTier: { type: String, enum: ["", "TIER_1", "TIER_2", "TIER_3"], default: "" },
  terms: { type: mongoose.Schema.Types.Mixed, default: {} },
  specifications: { type: mongoose.Schema.Types.Mixed, default: {} },
  images: { type: [String], default: [] },
  stock: { type: Number, required: true, default: 0, min: 0 },
  restrictionProvider: { type: String, enum: ["NONE","SAMSUNG_KNOX_GUARD","EXTERNAL_FINANCING_PROVIDER"], default: "NONE" },
  restrictionEnabled: { type: Boolean, default: false },
  graceDays: { type: Number, default: 3, min: 0, max: 90 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
phoneProductSchema.index({ active: 1, stock: 1, name: 1 });
phoneProductSchema.pre("validate", function () { this.sku = String(this.sku || "").trim().toUpperCase().replace(/\s+/g, "-"); });
module.exports = mongoose.model("PhoneProduct", phoneProductSchema);