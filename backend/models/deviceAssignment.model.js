const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  staff: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  reason: { type: String, required: true, immutable: true },
  startedAt: { type: Date, default: Date.now, immutable: true },
  endedAt: { type: Date, default: null },
  endedBy: mongoose.Schema.Types.ObjectId,
}, { collection: "deviceassignments", autoCreate: false, autoIndex: false, strict: "throw" });
schema.index({ device: 1 }, { unique: true, name: "enterprise_one_active_assignment_uq",
  partialFilterExpression: { endedAt: null } });
schema.index({ staff: 1, startedAt: -1 }, { name: "enterprise_assignment_staff_history" });
module.exports = (connection = mongoose.connection) =>
  connection.models.DeviceAssignment || connection.model("DeviceAssignment", schema);
