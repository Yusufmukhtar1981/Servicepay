const mongoose = require("mongoose");

const riderDeviceTokenSchema = new mongoose.Schema(
  {
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    platform: {
      type: String,
      enum: ["ANDROID", "IOS", "WEB", "UNKNOWN"],
      default: "UNKNOWN",
    },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

riderDeviceTokenSchema.index({ riderId: 1, active: 1, lastSeenAt: -1 });

module.exports = mongoose.model("RiderDeviceToken", riderDeviceTokenSchema);