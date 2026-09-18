const { mongoose } = require("./edupayModelUtils");

const schema = new mongoose.Schema({
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    immutable: true,
    index: true,
  },
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