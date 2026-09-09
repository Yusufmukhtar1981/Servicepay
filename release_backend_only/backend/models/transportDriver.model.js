const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  name: { type: String, required: true, trim: true }, phone: { type: String, required: true, trim: true },
  driverCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
  assignedBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
module.exports = mongoose.model("TransportDriver", schema);