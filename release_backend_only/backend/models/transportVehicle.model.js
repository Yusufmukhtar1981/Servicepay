const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  vehicleType: { type: String, required: true, trim: true, uppercase: true },
  registrationNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
  capacityKg: { type: Number, required: true, min: 0.01 },
  assignedBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
module.exports = mongoose.model("TransportVehicle", schema);