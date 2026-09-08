const mongoose = require("mongoose");
// Immutable idempotency ledger for investigator commands. Kept separate from
// alerts so retries cannot append a second note/event or audit entry.
const schema = new mongoose.Schema({
  alert: { type: mongoose.Schema.Types.ObjectId, ref: "RiskAlert", required: true, index: true },
  key: { type: String, required: true, trim: true, maxlength: 120 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true, maxlength: 30 },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
schema.index({ alert: 1, key: 1 }, { unique: true });
schema.pre("save", function () { if (!this.isNew) throw new Error("Risk alert commands are immutable."); });
["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany"].forEach((op) => schema.pre(op, function () { throw new Error("Risk alert commands are immutable."); }));
module.exports = mongoose.model("RiskAlertCommand", schema);