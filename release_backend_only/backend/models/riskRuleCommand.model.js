const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  rule: { type: mongoose.Schema.Types.ObjectId, ref: "RiskRule", required: true, index: true },
  key: { type: String, required: true, trim: true, maxlength: 120 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
schema.index({ rule: 1, key: 1 }, { unique: true });
schema.pre("save", function () { if (!this.isNew) throw new Error("Risk rule commands are immutable."); });
["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany"].forEach((op) => schema.pre(op, function () { throw new Error("Risk rule commands are immutable."); }));
module.exports = mongoose.model("RiskRuleCommand", schema);