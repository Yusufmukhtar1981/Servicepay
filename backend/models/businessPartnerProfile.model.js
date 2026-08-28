const mongoose = require("mongoose");

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
  permissions: {
    type: [String],
    enum: ["DASHBOARD", "OFFICERS", "CUSTOMERS", "APPLICATIONS", "REPAYMENTS", "REPORTS", "SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT", "VERIFICATION_REVIEW"],
    default: ["DASHBOARD", "OFFICERS", "CUSTOMERS", "APPLICATIONS", "REPAYMENTS", "REPORTS"],
  },
  status: { type: String, enum: ["ACTIVE", "SUSPENDED", "DISABLED"], default: "ACTIVE", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  statusChangedAt: { type: Date, default: null },
}, { timestamps: true });
businessPartnerProfileSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model("BusinessPartnerProfile", businessPartnerProfileSchema);