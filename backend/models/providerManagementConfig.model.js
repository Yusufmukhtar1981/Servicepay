const mongoose = require("mongoose");

const providerStateSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ["CLUBKONNECT", "NELLOBYTES", "TELECOM_ABODE"],
    required: true,
  },
  enabled: { type: Boolean, required: true, default: false },
}, { _id: false });

const providerManagementConfigSchema = new mongoose.Schema({
  // The built-in _id index is always unique, even if autoIndex is disabled
  // in production. A service must never have two competing routing records.
  _id: {
    type: String,
    enum: ["AIRTIME", "DATA", "ELECTRICITY", "CABLE"],
    required: true,
  },
  service: {
    type: String,
    enum: ["AIRTIME", "DATA", "ELECTRICITY", "CABLE"],
    required: true,
    unique: true,
    index: true,
  },
  primaryProvider: {
    type: String,
    enum: ["CLUBKONNECT", "NELLOBYTES", "TELECOM_ABODE", null],
    default: null,
  },
  fallbackProvider: {
    type: String,
    enum: ["CLUBKONNECT", "NELLOBYTES", "TELECOM_ABODE", null],
    default: null,
  },
  providerStates: { type: [providerStateSchema], default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.model("ProviderManagementConfig", providerManagementConfigSchema);