const mongoose = require("mongoose");

// Request metadata only. This collection intentionally has no request body,
// credentials, query values, or response payload fields.
const schema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actorRole: { type: String, trim: true, uppercase: true, default: "" },
  method: { type: String, trim: true, uppercase: true, required: true },
  path: { type: String, trim: true, required: true },
  statusCode: { type: Number, required: true },
  ipAddress: { type: String, trim: true, default: "" },
  userAgent: { type: String, trim: true, maxlength: 1000, default: "" },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

schema.index({ createdAt: -1 });
schema.index({ actorId: 1, createdAt: -1 });
module.exports = mongoose.model("AdminAccessLog", schema);