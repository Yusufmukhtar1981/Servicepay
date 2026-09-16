const { mongoose, immutableSchema } = require("./edupayModelUtils");
const schema = immutableSchema({
  key: { type: String, required: true, unique: true, immutable: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  command: { type: String, required: true, immutable: true },
  intentHash: { type: String, required: true, immutable: true },
  status: { type: String, enum: ["PROCESSING", "SUCCEEDED", "FAILED"], default: "PROCESSING" },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String, default: null },
}, { mutablePaths: ["status", "result", "error"] });
module.exports = mongoose.model("EduPayCommand", schema);