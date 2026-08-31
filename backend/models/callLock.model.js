const mongoose = require("mongoose");

// A unique participant lock is the database concurrency guard for active calls.
const callLockSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  callId: { type: mongoose.Schema.Types.ObjectId, ref: "CallSession", required: true, index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
callLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("CallLock", callLockSchema);