const mongoose = require("mongoose");
const history = new mongoose.Schema({ status: { type: String, required: true }, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, note: { type: String, default: "" }, changedAt: { type: Date, default: Date.now } }, { _id: false });
const phoneApplicationSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "PhoneProduct", required: true },
  productSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  kycSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  profileSnapshot: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  applicationInput: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  status: { type: String, enum: ["SUBMITTED","UNDER_REVIEW","MORE_INFORMATION_REQUIRED","REJECTED","AWAITING_DEPOSIT","DEPOSIT_PAID","DEVICE_ASSIGNED","ACTIVE","OVERDUE","COMPLETED","CANCELLED","REFUNDED"], default: "SUBMITTED", index: true },
  reservationRecoveryRequiredAt: { type: Date, default: null },
  statusHistory: { type: [history], default: [] },
  approvalSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  depositRequired: { type: Number, default: 0, min: 0 }, depositPaid: { type: Number, default: 0, min: 0 },
  totalPayable: { type: Number, default: 0, min: 0 }, outstandingBalance: { type: Number, default: 0, min: 0 },
  device: { type: mongoose.Schema.Types.ObjectId, ref: "PhoneDevice", default: undefined },
  refundedAt: { type: Date, default: null }, refundPayment: { type: mongoose.Schema.Types.ObjectId, ref: "PhonePayment", default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, approvedAt: Date,
  assignedOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
}, { timestamps: true });
phoneApplicationSchema.index({ customer: 1, createdAt: -1 }); phoneApplicationSchema.index({ status: 1, createdAt: -1 });
phoneApplicationSchema.index({device:1},{unique:true,partialFilterExpression:{device:{$type:"objectId"}}});
phoneApplicationSchema.pre("save", function () {
  if (this.status === "REFUNDED" && this.refundedAt) {
    this.device = undefined;
    this.outstandingBalance = 0;
  }
});
phoneApplicationSchema.pre("save", async function () {
  if (!this.isNew && this.isModified("approvalSnapshot")) {
    const original = await this.constructor.findById(this._id).select("approvalSnapshot").lean();
    if (original?.approvalSnapshot) throw new Error("Phone financing approval terms are immutable.");
  }
});
module.exports = mongoose.model("PhoneApplication", phoneApplicationSchema);