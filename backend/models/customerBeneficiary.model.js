const mongoose = require("mongoose");

const customerBeneficiarySchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    phone: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    network: { type: String, default: "", trim: true, maxlength: 30 },
    serviceTypes: {
      type: [{ type: String, enum: ["AIRTIME", "DATA"] }],
      default: [],
    },
  },
  { timestamps: true }
);

customerBeneficiarySchema.index({ customer: 1, phone: 1 }, { unique: true });
customerBeneficiarySchema.index({ customer: 1, name: 1 });

module.exports = mongoose.model("CustomerBeneficiary", customerBeneficiarySchema);