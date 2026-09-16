const { mongoose, money, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySettlement", required: true, immutable: true, unique: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayPlan", required: true, immutable: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true },
  amount: { ...money(0), required: true, immutable: true },
  reference: { type: String, required: true, unique: true, immutable: true },
  reason: { type: String, required: true, maxlength: 1000, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  actorType: { type: String, enum: ["USER", "PROVIDER", "SYSTEM"], default: "USER", immutable: true },
  actorLabel: { type: String, default: null, immutable: true },
});
schema.pre("validate", function () { if (this.actorType === "USER" && !this.actor) throw new Error("USER EduPay reversals require an actor."); if (this.actorType !== "USER" && !this.actorLabel) throw new Error("Provider/system EduPay reversals require actorLabel."); });
module.exports = mongoose.model("EduPaySettlementReversal", schema);