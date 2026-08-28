const mongoose = require("mongoose");
const deviceSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "PhoneProduct", required: true, index: true },
  imei1: { type: String, required: true, unique: true, trim: true, uppercase: true },
  imei2: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
  serialNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
  status: { type: String, enum: ["AVAILABLE","RESERVED","ASSIGNED","ACTIVE_FINANCE","COMPLETED"], default: "AVAILABLE", index: true },
  reservedForApplication: { type: mongoose.Schema.Types.ObjectId, ref: "PhoneApplication", default: null, index: true },
  reservedForCustomer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reservedAt: { type: Date, default: null }, reservationExpiresAt: { type: Date, default: null, index: true },
  receivedAt: { type: Date, default: Date.now }, handoverAt: { type: Date, default: null }, activatedAt: { type: Date, default: null },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  application: { type: mongoose.Schema.Types.ObjectId, ref: "PhoneApplication", default: null, unique: true, sparse: true },
  statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });
deviceSchema.pre("validate", function () { ["imei1","imei2","serialNumber"].forEach(k => { if (this[k]) this[k] = String(this[k]).replace(/\s+/g, "").toUpperCase(); }); });
deviceSchema.index({ product: 1, status: 1 });
module.exports = mongoose.model("PhoneDevice", deviceSchema);