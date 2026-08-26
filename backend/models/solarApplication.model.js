const mongoose = require("mongoose");
const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  note: { type: String, trim: true, default: "", maxlength: 1000 },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });
const scheduleSchema = new mongoose.Schema({
  installmentNumber: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["PENDING", "PARTIAL", "PAID", "OVERDUE"], default: "PENDING" },
  paidAt: { type: Date, default: null },
}, { _id: true });
const applicationPreferencesSchema = new mongoose.Schema({
  occupationBusiness: { type: String, trim: true, maxlength: 200 },
  monthlyIncomeRange: {
    type: String,
    enum: [
      "Below ₦50,000",
      "₦50,000 - ₦100,000",
      "₦100,001 - ₦250,000",
      "₦250,001 - ₦500,000",
      "Above ₦500,000",
    ],
  },
  preferredRepaymentPeriod: {
    type: String,
    validate: {
      validator: (value) => {
        if (value === undefined || value === null || value === "") return true;
        const months = Number(value);
        return Number.isInteger(months) && months >= 1 && months <= 120;
      },
      message: "Preferred repayment period must be from 1 to 120 months.",
    },
  },
  upfrontPaymentOption: {
    type: String,
    enum: [
      "Standard package deposit",
      "Pay a larger upfront amount",
      "Pay in full upfront",
    ],
  },
}, { _id: false });
const solarApplicationSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  package: { type: mongoose.Schema.Types.ObjectId, ref: "SolarPackage", required: true },
  packageSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  profileSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  kycSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  business: { type: mongoose.Schema.Types.Mixed, default: {} },
  guarantor: { type: mongoose.Schema.Types.Mixed, default: {} },
  applicationPreferences: { type: applicationPreferencesSchema, default: () => ({}) },
  declarations: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "AWAITING_DEPOSIT", "DEPOSIT_PAID", "READY_FOR_INSTALLATION", "INSTALLED", "FINANCE_ACTIVE", "COMPLETED", "OVERDUE", "DEFAULT_REVIEW", "RECOVERY_REQUIRED", "RECOVERED", "CANCELLED", "ACTIVE", "RECOVERY"], default: "SUBMITTED", index: true },
  statusHistory: { type: [historySchema], default: [] },
  // Written exactly once by the guarded approval controller. It cannot use
  // Mongoose's immutable option because that also prevents a null value from
  // being populated during approval.
  approvalSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  depositRequired: { type: Number, default: 0, min: 0 },
  depositPaid: { type: Number, default: 0, min: 0 },
  totalPayable: { type: Number, default: 0, min: 0 },
  amountPaid: { type: Number, default: 0, min: 0 },
  outstandingBalance: { type: Number, default: 0, min: 0 },
  paymentSchedule: { type: [scheduleSchema], default: [] },
  recovery: { type: mongoose.Schema.Types.Mixed, default: null },
  installation: { type: mongoose.Schema.Types.Mixed, default: null },
  fieldHandover: { type: mongoose.Schema.Types.Mixed, default: null },
  stockReservation: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });
solarApplicationSchema.index({ customer: 1, createdAt: -1 });
solarApplicationSchema.index({ status: 1, createdAt: -1 });
solarApplicationSchema.pre("save", async function () {
  if (!this.isNew && this.isModified("approvalSnapshot")) {
    const original = await this.constructor.findById(this._id).select("approvalSnapshot").lean();
    if (original?.approvalSnapshot) {
      throw new Error("Solar approval price and terms snapshots are immutable.");
    }
  }
});
module.exports = mongoose.model("SolarApplication", solarApplicationSchema);