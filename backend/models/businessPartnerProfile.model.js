const mongoose = require("mongoose");
const {
  BUSINESS_PARTNER_PERMISSION_VALUES,
  BUSINESS_PARTNER_SERVICES,
  BUSINESS_PARTNER_VIEW_PERMISSIONS,
} = require("../config/businessPartnerPermissions");

const businessPartnerProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  partnerId: { type: String, required: true, unique: true, uppercase: true, trim: true, immutable: true, index: true },
  businessName: { type: String, required: true, trim: true, maxlength: 160 },
  contactName: { type: String, trim: true, maxlength: 160, default: "" },
  territory: {
    states: { type: [String], default: [] },
    lgas: { type: [String], default: [] },
    description: { type: String, trim: true, maxlength: 500, default: "" },
  },
  services: {
    type: [String],
    enum: BUSINESS_PARTNER_SERVICES,
    default: [],
  },
  permissions: {
    type: [String],
    enum: BUSINESS_PARTNER_PERMISSION_VALUES,
    default: () => [...BUSINESS_PARTNER_VIEW_PERMISSIONS],
  },
  status: { type: String, enum: ["ACTIVE", "SUSPENDED", "DISABLED"], default: "ACTIVE", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  statusChangedAt: { type: Date, default: null },
}, { timestamps: true });
businessPartnerProfileSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model("BusinessPartnerProfile", businessPartnerProfileSchema);