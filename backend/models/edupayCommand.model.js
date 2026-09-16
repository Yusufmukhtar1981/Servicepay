const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  key: { type: String, required: true, unique: true, immutable: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true, index: true },
  actorType: { type: String, enum: ["USER", "PROVIDER", "SYSTEM"], default: "USER", immutable: true },
  actorLabel: { type: String, default: null, immutable: true },
  command: { type: String, required: true, immutable: true },
  intentHash: { type: String, required: true, immutable: true },
  status: { type: String, enum: ["PROCESSING", "SUCCEEDED", "FAILED"], default: "PROCESSING" },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String, default: null },
}, { mutablePaths: ["status", "result", "error"] });
schema.pre("validate", function () { if (this.actorType === "USER" && !this.owner) throw new Error("USER EduPay commands require an owner."); if (this.actorType !== "USER" && !this.actorLabel) throw new Error("Provider/system EduPay commands require actorLabel."); });
module.exports = mongoose.model("EduPayCommand", schema);