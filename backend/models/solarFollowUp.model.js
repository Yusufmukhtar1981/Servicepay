const mongoose = require("mongoose");

const solarFollowUpSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: "SolarApplication", required: true, index: true },
    finance: { type: mongoose.Schema.Types.ObjectId, ref: "SolarFinance", default: null, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    officer: { type: mongoose.Schema.Types.ObjectId, ref: "SolarOfficer", required: true, index: true },
    followUpDate: { type: Date, default: Date.now },
    contactMethod: {
      type: String,
      enum: ["PHONE", "SMS", "WHATSAPP", "VISIT", "OTHER"],
      required: true,
    },
    notes: { type: String, trim: true, required: true, maxlength: 3000 },
    promiseToPayDate: { type: Date, default: null },
    customerResponse: { type: String, trim: true, default: "", maxlength: 2000 },
    outcome: {
      type: String,
      enum: ["CONTACTED", "PROMISE_TO_PAY", "UNABLE_TO_CONTACT", "ADDRESS_VISIT", "RECOVERY_RECOMMENDED", "REPOSSESSION_RECOMMENDED", "OTHER"],
      default: "CONTACTED",
    },
  },
  { timestamps: true }
);

solarFollowUpSchema.index({ officer: 1, followUpDate: -1 });

module.exports = mongoose.model("SolarFollowUp", solarFollowUpSchema);