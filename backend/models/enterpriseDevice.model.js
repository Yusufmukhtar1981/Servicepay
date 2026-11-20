const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deviceId: { type: String, required: true, immutable: true },
  registrationKey: { type: String, required: true, immutable: true },
  registrationDigest: { type: String, required: true, immutable: true },
  manufacturer: { type: String, required: true },
  model: { type: String, required: true },
  imei1: { type: String, required: true, immutable: true },
  imei2: { type: String, immutable: true },
  imeis: { type: [String], required: true, immutable: true, default: undefined },
  serialNumber: { type: String, required: true, immutable: true },
  androidVersion: String,
  purchaseDate: Date,
  purchasePrice: Number,
  warrantyExpiry: Date,
  assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  department: String,
  state: String,
  status: { type: String, enum: ["AVAILABLE", "ASSIGNED", "INACTIVE", "LOST_STOLEN", "RETIRED"], default: "AVAILABLE" },
  version: { type: Number, default: 0 },
  registeredAt: { type: Date, default: Date.now, immutable: true },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  enrollment: {
    hash: { type: String, select: false },
    expiresAt: Date,
    consumedAt: Date,
  },
  companion: {
    installationId: String,
    tokenHash: { type: String, select: false },
    previousTokenHash: { type: String, select: false },
    previousTokenExpiresAt: Date,
    enrolledAt: Date,
    revokedAt: Date,
    lastSyncAt: Date,
    lastHeartbeatAt: Date,
    rateWindow: Date,
    rateCount: Number,
    reported: { manufacturer: String, model: String, androidVersion: String, appVersion: String },
  },
}, { collection: "enterprisedevices", autoCreate: false, autoIndex: false, timestamps: true, strict: "throw" });
schema.index({ deviceId: 1 }, { unique: true, name: "enterprise_device_id_uq" });
// A single multikey index protects BOTH IMEI slots across all devices.
schema.index({ imeis: 1 }, { unique: true, name: "enterprise_imei_slots_uq" });
schema.index({ serialNumber: 1 }, { unique: true, name: "enterprise_serial_uq" });
schema.index({ registrationKey: 1 }, { unique: true, name: "enterprise_registration_request_uq" });
schema.index({ "companion.installationId": 1 }, { unique: true, name: "enterprise_installation_uq",
  partialFilterExpression: { "companion.installationId": { $type: "string" } } });
module.exports = (connection = mongoose.connection) =>
  connection.models.EnterpriseDevice || connection.model("EnterpriseDevice", schema);
