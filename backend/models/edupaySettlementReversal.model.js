const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", required: true, immutable: true, unique: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true },
  amount: { ...money(0), required: true, immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  reason: { type: String, required: true, maxlength: 1000, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
});
module.exports = mongoose.model("EduPaySettlementReversal", schema);