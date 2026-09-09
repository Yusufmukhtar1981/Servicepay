const mongoose = require("mongoose");

const protectedCategories = [
  "FOOD_PACKAGE",
  "SCHOOL_FEES",
  "MEDICAL_SUPPORT",
];

const protectedStatuses = [
  "SUBMITTED",
  "MORE_INFORMATION_REQUIRED",
  "UNDER_REVIEW",
  "APPROVED",
  "FUNDING_IN_PROGRESS",
  "FULLY_FUNDED",
  "PAID_TO_PROVIDER",
  "FULFILLED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
];

const legacyStatuses = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "ASSIGNED",
  "REFUNDED",
];

const documentSchema = new mongoose.Schema(
  {
    assetId: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true, maxlength: 180 },
    mimeType: { type: String, required: true, trim: true },
    resourceType: { type: String, enum: ["image", "raw"], default: "image" },
    uploadedAt: { type: Date, default: Date.now },
    requestReference: { type: String, default: "", trim: true, maxlength: 80 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true, uppercase: true },
    fromStatus: { type: String, default: "", trim: true, uppercase: true },
    toStatus: { type: String, default: "", trim: true, uppercase: true },
    message: { type: String, default: "", trim: true, maxlength: 1000 },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: "SYSTEM", trim: true, uppercase: true },
    occurredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const fundingEventSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    sourceType: {
      type: String,
      enum: ["HEAD_OFFICE", "NGO", "COMPANY", "DONOR_RESERVED"],
      required: true,
    },
    reference: { type: String, required: true, trim: true, maxlength: 160 },
    receiptReference: { type: String, default: "", trim: true, maxlength: 300 },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 180 },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const amanaOrderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        ...protectedCategories,
        "BUILDING_SUPPORT",
        "LIVESTOCK_SUPPORT",
        "RENT_SUPPORT",
        "SOLAR_AND_UTILITIES",
        "CUSTOM_REQUEST",
      ],
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    beneficiary: {
      fullName: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      relationship: { type: String, default: "", trim: true },
      state: { type: String, required: true, trim: true },
      lga: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true },
      landmark: { type: String, default: "", trim: true },
    },
    categoryDetails: {
      householdSize: { type: Number, default: null, min: 1 },
      foodItems: { type: [String], default: [] },
      deliveryInstructions: { type: String, default: "", trim: true, maxlength: 1000 },
      schoolName: { type: String, default: "", trim: true },
      studentName: { type: String, default: "", trim: true },
      classLevel: { type: String, default: "", trim: true },
      termSession: { type: String, default: "", trim: true },
      studentId: { type: String, default: "", trim: true },
      facilityName: { type: String, default: "", trim: true },
      patientName: { type: String, default: "", trim: true },
      treatmentDescription: { type: String, default: "", trim: true, maxlength: 2000 },
      invoiceNumber: { type: String, default: "", trim: true },
    },
    supportingDocuments: { type: [documentSchema], default: [] },
    providerDetails: {
      type: {
        type: String,
        enum: ["FOOD_VENDOR", "SCHOOL", "HOSPITAL", "PHARMACY", "VENDOR", "OTHER"],
        default: "OTHER",
      },
      name: { type: String, default: "", trim: true },
      phone: { type: String, default: "", trim: true },
      accountName: { type: String, default: "", trim: true },
      accountNumber: { type: String, default: "", trim: true },
      bankName: { type: String, default: "", trim: true },
      address: { type: String, default: "", trim: true },
      additionalInformation: { type: String, default: "", trim: true, maxlength: 1500 },
      verificationStatus: {
        type: String,
        enum: ["PENDING", "VERIFIED", "REJECTED"],
        default: "PENDING",
        index: true,
      },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      verifiedAt: { type: Date, default: null },
      verificationNote: { type: String, default: "", trim: true, maxlength: 1000 },
    },
    amount: { type: Number, required: true, min: 1 },
    serviceFee: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "NGN", uppercase: true, trim: true },
    approvedAmount: { type: Number, default: null, min: 1 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    approvalNote: { type: String, default: "", trim: true, maxlength: 1000 },
    fundingRequired: { type: Number, default: 0, min: 0 },
    fundedAmount: { type: Number, default: 0, min: 0 },
    fundingEvents: { type: [fundingEventSchema], default: [] },
    providerPayment: {
      status: {
        type: String,
        enum: ["NOT_STARTED", "RECORDED", "FAILED", "REVERSED"],
        default: "NOT_STARTED",
      },
      method: { type: String, enum: ["MANUAL_EXTERNAL"], default: null },
      amount: { type: Number, default: 0, min: 0 },
      reference: { type: String, default: "", trim: true },
      /*
       * Keep this unset until a provider payment exists. A sparse unique
       * index then protects real payment keys without indexing empty values.
       */
      idempotencyKey: { type: String, default: undefined, trim: true },
      receipt: { type: documentSchema, default: null },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      recordedAt: { type: Date, default: null },
      note: { type: String, default: "", trim: true, maxlength: 1500 },
    },
    fulfilmentProof: {
      receipt: { type: documentSchema, default: null },
      documents: { type: [documentSchema], default: [] },
      /* Legacy URL-based proof fields stay readable for historical orders. */
      receiptUrl: { type: String, default: "", trim: true },
      imageUrls: { type: [String], default: [] },
      notes: { type: String, default: "", trim: true, maxlength: 2000 },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      uploadedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: [...protectedStatuses, ...legacyStatuses],
      default: "SUBMITTED",
      index: true,
    },
    statusHistory: { type: [historySchema], default: [] },
    moreInformationRequest: { type: String, default: "", trim: true, maxlength: 1000 },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 1000 },
    cancellationReason: { type: String, default: "", trim: true, maxlength: 1000 },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: null },
    preferredFulfilmentDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    processingStartedAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, default: "", trim: true, maxlength: 1000 },
    refundedAmount: { type: Number, default: 0, min: 0 },
    vendor: {
      name: { type: String, default: "", trim: true },
      phone: { type: String, default: "", trim: true },
      address: { type: String, default: "", trim: true },
      accountName: { type: String, default: "", trim: true },
      accountNumber: { type: String, default: "", trim: true },
      bankName: { type: String, default: "", trim: true },
    },

    /*
     * Legacy fields are intentionally retained. Existing direct-wallet
     * records remain readable but are never used for protected payouts.
     */
    paymentMethod: { type: String, default: "PROTECTED_PROVIDER_PAYMENT" },
    paymentStatus: { type: String, default: "NOT_APPLICABLE", index: true },
    paidAt: { type: Date, default: null },
    paymentTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
    refundTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
    walletDebited: { type: Boolean, default: false },
    walletRefunded: { type: Boolean, default: false },
    adminNotes: { type: String, default: "", trim: true, maxlength: 3000 },
  },
  { timestamps: true }
);

amanaOrderSchema.index({ customer: 1, createdAt: -1 });
amanaOrderSchema.index({ status: 1, createdAt: -1 });
amanaOrderSchema.index({ category: 1, status: 1 });
amanaOrderSchema.index({ "providerPayment.idempotencyKey": 1 }, { unique: true, sparse: true });
amanaOrderSchema.index({ "fundingEvents.idempotencyKey": 1 });

amanaOrderSchema.methods.toSafeObject = function () {
  const order = this.toObject();
  delete order.adminNotes;
  delete order.paymentTransaction;
  delete order.refundTransaction;
  if (order.providerDetails) {
    delete order.providerDetails.accountName;
    delete order.providerDetails.accountNumber;
    delete order.providerDetails.bankName;
  }
  if (order.providerPayment) {
    delete order.providerPayment.idempotencyKey;
    delete order.providerPayment.recordedBy;
  }
  return order;
};

module.exports = mongoose.model("AmanaOrder", amanaOrderSchema);
module.exports.PROTECTED_AMANA_CATEGORIES = protectedCategories;
module.exports.PROTECTED_AMANA_STATUSES = protectedStatuses;