const mongoose = require("mongoose");

const solarOfficerCommissionSchema = new mongoose.Schema(
  {
    officer: { type: mongoose.Schema.Types.ObjectId, ref: "SolarOfficer", required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "SolarApplication", required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "SolarPayment", default: null, index: true },
    commissionType: {
      type: String,
      enum: ["SOLAR_SALE_2_PERCENT", "SOLAR_DEPOSIT_5_PERCENT"],
      required: true,
      index: true,
    },
    sourceKey: { type: String, required: true, unique: true, index: true },
    baseAmount: { type: Number, required: true, min: 0 },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    commissionAmount: { type: Number, required: true, min: 0 },
    lockedAmount: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["PENDING", "AVAILABLE", "PAID", "REVERSED"],
      default: "AVAILABLE",
      index: true,
    },
    availableAt: { type: Date, default: Date.now },
    reversedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

solarOfficerCommissionSchema.index({ officer: 1, status: 1, createdAt: -1 });
solarOfficerCommissionSchema.index({ application: 1, commissionType: 1 }, { unique: true });

module.exports = mongoose.model("SolarOfficerCommission", solarOfficerCommissionSchema);