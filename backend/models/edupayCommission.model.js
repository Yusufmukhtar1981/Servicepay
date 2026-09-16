const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", required: true, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  amount: { ...money(0), required: true, min: 0.01, immutable: true },
  direction: { type: String, enum: ["RECEIVABLE", "WITHHELD", "REVERSAL"], required: true, immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  original: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayCommission", default: null, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
});
module.exports = mongoose.model("EduPayCommission", schema);