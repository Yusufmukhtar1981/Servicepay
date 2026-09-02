const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "InterstateShipment", required: true, index: true },
  status: { type: String, required: true, uppercase: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actorRole: { type: String, default: "SYSTEM", uppercase: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
  locationText: { type: String, default: "", trim: true }, note: { type: String, default: "", trim: true },
  evidenceUrls: { type: [String], default: [] }, publicVisible: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ shipmentId: 1, createdAt: 1 });
module.exports = mongoose.model("ShipmentStatusHistory", schema);