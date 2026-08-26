const mongoose = require("mongoose");

const solarOfficerSchema = new mongoose.Schema(
  {
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
    dateJoined: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

solarOfficerSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("SolarOfficer", solarOfficerSchema);