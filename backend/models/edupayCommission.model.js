const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", required: true, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  amount: { ...money(0), required: true, min: 0.01, immutable: true },
  direction: { type: String, enum: ["RECEIVABLE", "WITHHELD", "REVERSAL"], required: true, immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  original: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayCommission", default: null, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  actorType: { type: String, enum: ["USER", "PROVIDER", "SYSTEM"], default: "USER", immutable: true },
  actorLabel: { type: String, default: null, immutable: true },
});
schema.pre("validate", function () { if (this.actorType === "USER" && !this.actor) throw new Error("USER EduPay commission records require an actor."); if (this.actorType !== "USER" && !this.actorLabel) throw new Error("Provider/system EduPay commission records require actorLabel."); });
module.exports = mongoose.model("EduPayCommission", schema);