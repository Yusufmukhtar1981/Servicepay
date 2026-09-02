const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  tripCode: { type: String, required: true, unique: true, uppercase: true, index: true },
  originBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  destinationBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: "TransportDriver", required: true, index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "TransportVehicle", required: true },
  departureAt: { type: Date, required: true }, expectedArrivalAt: { type: Date, required: true },
  shipmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "InterstateShipment" }],
  status: { type: String, enum: ["PLANNED", "LOADING", "DEPARTED", "IN_TRANSIT", "ARRIVED", "COMPLETED", "CANCELLED"], default: "PLANNED", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
schema.index({ originBranchId: 1, status: 1, departureAt: 1 });
module.exports = mongoose.model("TransportTrip", schema);