const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, immutable: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  role: { type: String, enum: ["OWNER", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "FINANCE", "STAFF"], default: "STAFF" },
  status: { type: String, enum: ["ACTIVE", "SUSPENDED", "INVITED"], default: "INVITED", index: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
}, { timestamps: true });
schema.index({ school: 1, user: 1 }, { unique: true });
module.exports = mongoose.model("EduPaySchoolUser", schema);