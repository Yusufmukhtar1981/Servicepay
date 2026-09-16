const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, unique: true, immutable: true },
  accountName: { type: String, required: true, trim: true },
  bankName: { type: String, required: true, trim: true },
  bankCode: { type: String, required: true, trim: true },
  encryptedAccountNumber: { type: String, required: true, select: false },
  accountNumberLast4: { type: String, required: true },
  verified: { type: Boolean, default: false, index: true },
  active: { type: Boolean, default: false, index: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
module.exports = mongoose.model("EduPaySettlementAccount", schema);