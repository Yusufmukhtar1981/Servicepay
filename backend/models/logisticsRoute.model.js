const mongoose = require("mongoose");

const logisticsRouteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  originState: { type: String, required: true, trim: true, uppercase: true, index: true },
  originBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  destinationState: { type: String, required: true, trim: true, uppercase: true, index: true },
  destinationBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  distanceKm: { type: Number, min: 0, default: null },
  baseFare: { type: Number, required: true, min: 0 },
  minimumWeightKg: { type: Number, required: true, min: 0, default: 0 },
  maximumWeightKg: { type: Number, required: true, min: 0 },
  pricePerAdditionalKg: { type: Number, required: true, min: 0 },
  expressEnabled: { type: Boolean, default: false },
  expressSurcharge: { type: Number, min: 0, default: 0 },
  pickupFee: { type: Number, min: 0, default: 0 },
  doorDeliveryFee: { type: Number, min: 0, default: 0 },
  branchCollectionFee: { type: Number, min: 0, default: 0 },
  protectionEnabled: { type: Boolean, default: false },
  protectionPercent: { type: Number, min: 0, max: 100, default: 0 },
  protectionFlatFee: { type: Number, min: 0, default: 0 },
  standardDeliveryTime: { type: String, required: true, trim: true },
  expressDeliveryTime: { type: String, default: "", trim: true },
  status: { type: String, enum: ["ACTIVE", "PAUSED", "UNAVAILABLE"], default: "ACTIVE", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
logisticsRouteSchema.index({ originBranchId: 1, destinationBranchId: 1 }, { unique: true });
module.exports = mongoose.model("LogisticsRoute", logisticsRouteSchema);