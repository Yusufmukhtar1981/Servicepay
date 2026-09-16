const { mongoose } = require("./edupayModelUtils");
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 180 },
  schoolType: { type: String, trim: true, maxlength: 80 },
  registrationNumber: { type: String, trim: true, maxlength: 120 },
  address: { type: String, required: true, trim: true, maxlength: 500 },
  state: { type: String, required: true, trim: true, maxlength: 80 },
  lga: { type: String, trim: true, maxlength: 80 },
  contactPerson: { type: String, trim: true, maxlength: 160 },
  phone: { type: String, trim: true, maxlength: 40 },
  email: { type: String, trim: true, lowercase: true, maxlength: 180 },
  bankDetails: { accountName: String, accountNumber: String, bankName: String, bankCode: String },
  logo: { type: String, default: null },
  supportingDocuments: [{ type: String }],
  authorizedRepresentative: { type: String, trim: true, maxlength: 180 },
  status: { type: String, enum: ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"], default: "PENDING", index: true },
  active: { type: Boolean, default: false, index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, maxlength: 1000 },
}, { timestamps: true });
schema.index({ registrationNumber: 1 }, { unique: true, sparse: true });
schema.index({ status: 1, active: 1 });
module.exports = mongoose.model("EduPaySchool", schema);