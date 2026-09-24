const { mongoose } = require("./edupayModelUtils");

const schema = new mongoose.Schema({
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    immutable: true,
    index: true,
  },
  // State-manager registrations retain their origin independently of the
  // requester identity used by the existing customer discovery flow.
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  createdByRole: { type: String, enum: ["STATE_MANAGER", null], default: null },
  stateManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  schoolType: { type: String, trim: true, maxlength: 80, default: null },
  proprietorName: { type: String, trim: true, maxlength: 160, default: null },
  registrationNumber: { type: String, trim: true, maxlength: 120, default: null },
  state: { type: String, trim: true, maxlength: 80, default: null },
  lga: { type: String, trim: true, maxlength: 80, default: null },
  contactPerson: { type: String, trim: true, maxlength: 160, default: null },
  email: { type: String, trim: true, lowercase: true, maxlength: 180, default: null },
  authorizedRepresentative: { type: String, trim: true, maxlength: 180, default: null },
  schoolName: { type: String, required: true, trim: true, maxlength: 180 },
  normalizedSchoolName: { type: String, required: true, immutable: true },
  location: { type: String, required: true, trim: true, maxlength: 240 },
  normalizedLocation: { type: String, required: true, immutable: true },
  contactPhone: { type: String, trim: true, maxlength: 40, default: null },
  status: {
    type: String,
    enum: ["PENDING_REVIEW", "CONTACTED", "CLOSED", "APPROVED", "REJECTED"],
    default: "PENDING_REVIEW",
    index: true,
  },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectionReason: { type: String, trim: true, maxlength: 1000, default: null },
  school: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", default: null, index: true },
}, { timestamps: true });

schema.index(
  { parent: 1, normalizedSchoolName: 1, normalizedLocation: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["PENDING_REVIEW", "CONTACTED"] },
    },
  }
);

module.exports = mongoose.model("EduPaySchoolRequest", schema);