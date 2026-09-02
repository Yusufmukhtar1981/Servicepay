const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsRoute", required: true, index: true },
  routeVersion: { type: String, required: true },
  inputHash: { type: String, required: true },
  quote: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("LogisticsQuote", schema);