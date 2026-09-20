const { mongoose } = require("./edupayModelUtils");

const schema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true, immutable: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  expiresAt: { type: Date, required: true, immutable: true, index: true },
  usedAt: { type: Date, default: null, index: true },
}, { timestamps: true });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("EduPaySchoolHandoff", schema);