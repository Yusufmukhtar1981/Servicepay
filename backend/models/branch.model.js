const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{2,32}$/ },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  status: { type: String, enum: ["DRAFT", "ACTIVE", "INACTIVE", "SUSPENDED"], default: "DRAFT", index: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  staffIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  address: { type: String, trim: true, default: "" },
  state: { type: String, trim: true, default: "" },
  lga: { type: String, trim: true, default: "" },
  phone: { type: String, trim: true, default: "" },
  email: { type: String, trim: true, lowercase: true, default: "" },
  openingDate: { type: Date, default: null },
  notes: { type: String, trim: true, default: "" },
  assignedModules: { type: [{ type: String, trim: true, uppercase: true }], default: [] },
  latitude: { type: Number, min: -90, max: 90, default: null },
  longitude: { type: Number, min: -180, max: 180, default: null },
  lifecycle: {
    activatedAt: { type: Date, default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    suspensionReason: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
branchSchema.index({ status: 1, state: 1 });
branchSchema.index({ managerId: 1, status: 1 });
branchSchema.pre("validate", function () { if (this.code) this.code = String(this.code).trim().toUpperCase(); });
module.exports = mongoose.model("Branch", branchSchema);