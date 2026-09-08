const mongoose = require("mongoose");
const solarSettingsSchema = new mongoose.Schema({
  key: { type: String, default: "default", unique: true },
  overdueGraceDays: { type: Number, default: 0, min: 0, max: 365 },
  applicationEnabled: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
module.exports = mongoose.model("SolarSettings", solarSettingsSchema);