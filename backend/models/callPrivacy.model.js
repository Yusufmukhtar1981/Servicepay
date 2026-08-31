const mongoose = require("mongoose");

const callPrivacySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  callsEnabled: { type: Boolean, default: true },
  blockedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

module.exports = mongoose.model("CallPrivacy", callPrivacySchema);