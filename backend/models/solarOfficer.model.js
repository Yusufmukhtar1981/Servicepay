const mongoose = require("mongoose");

const solarOfficerSchema = new mongoose.Schema(
  {
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    officerId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    state: { type: String, required: true, trim: true },
    lga: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "INACTIVE"],
      default: "ACTIVE",
      index: true,
    },
    authorizationVersion: { type: Number, default: 0, min: 0 },
    dateJoined: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Optional, backward-compatible ownership link for Business Partner teams.
    businessPartner: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessPartnerProfile", default: null, index: true },
  },
  { timestamps: true }
);

solarOfficerSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("SolarOfficer", solarOfficerSchema);