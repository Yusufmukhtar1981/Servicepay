const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 180 },
  dateOfBirth: Date,
  gender: { type: String, trim: true, maxlength: 30 },
  photo: { type: String, default: null },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE", index: true },
}, { timestamps: true });
schema.index({ parent: 1, fullName: 1 });
module.exports = mongoose.model("EduPayChild", schema);