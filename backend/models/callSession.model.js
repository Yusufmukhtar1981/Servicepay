const mongoose = require("mongoose");

// Deliberately metadata-only: SDP, ICE candidates and media are never schema fields.
const callSessionSchema = new mongoose.Schema({
  callerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  calleeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  state: {
    type: String,
    enum: ["RINGING", "ACCEPTED", "DECLINED", "CANCELLED", "ENDED", "MISSED", "FAILED"],
    default: "RINGING",
    index: true,
  },
  startedAt: { type: Date, default: Date.now },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  endReason: { type: String, trim: true, maxlength: 80, default: "" },
  expiresAt: { type: Date, required: true, index: true },
  activeExpiresAt: { type: Date, default: null, index: true },
  requestKey: { type: String, trim: true, maxlength: 120, default: undefined },
}, { timestamps: true, strict: "throw" });

callSessionSchema.index({ callerId: 1, createdAt: -1 });
callSessionSchema.index({ calleeId: 1, createdAt: -1 });
callSessionSchema.index({ state: 1, expiresAt: 1 });
callSessionSchema.index({ callerId: 1, requestKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("CallSession", callSessionSchema);