const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
  payloadHash: { type: String, required: true, immutable: true },
  responseRecordIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true });
schema.index({ school: 1, idempotencyKey: 1 }, { unique: true });
module.exports = mongoose.model("EduPayAttendanceBatch", schema);