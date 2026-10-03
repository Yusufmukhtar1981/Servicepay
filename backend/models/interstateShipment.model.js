const mongoose = require("mongoose");
const partySchema = new mongoose.Schema({ name: String, phone: String, email: String, state: String, lga: String, address: String, landmark: { type: String, default: "" } }, { _id: false });
const shipmentSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: function () { return this.creationChannel !== "OFFICE"; }, index: true },
  orderType: { type: String, enum: ["INTERSTATE"], default: "INTERSTATE", immutable: true, index: true },
  orderReference: { type: String, immutable: true },
  creationChannel: { type: String, enum: ["CUSTOMER", "OFFICE"], default: "CUSTOMER", immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", immutable: true },
  officeName: { type: String, immutable: true },
  officeIdempotencyKey: { type: String, select: false },
  officeFingerprint: { type: String, select: false },
  assignmentLeg: { type: String, enum: ["ORIGIN", "DESTINATION"] },
  assignmentHistory: [{
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    previousRiderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    leg: { type: String, enum: ["ORIGIN", "DESTINATION"] },
    assignedAt: { type: Date, default: Date.now },
  }],
  trackingEmail: {
    recipient: String,
    status: { type: String, enum: ["PENDING", "SENDING", "RETRY", "SENT", "MISSING_EMAIL"] },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: Date,
    leaseUntil: Date,
    leaseToken: String,
    sentAt: Date,
    lastError: String,
  },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsRoute", required: true, index: true },
  originBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  destinationBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  trackingNumber: { type: String, unique: true, sparse: true, immutable: true, uppercase: true, trim: true, index: true },
  sender: { type: partySchema, required: true },
  receiver: { type: partySchema, required: true },
  pickupMethod: { type: String, enum: ["RIDER_PICKUP", "BRANCH_DROP_OFF"], required: true },
  deliveryMethod: { type: String, enum: ["DOOR_DELIVERY", "BRANCH_COLLECTION"], required: true },
  parcel: {
    category: { type: String, enum: ["DOCUMENTS", "ELECTRONICS", "FASHION", "FOOD_NON_PERISHABLE", "COSMETICS", "HOUSEHOLD_ITEMS", "SPARE_PARTS", "BUSINESS_GOODS", "OTHER"], required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 }, quantity: { type: Number, min: 1, required: true },
    declaredValue: { type: Number, min: 0, required: true }, weightKg: { type: Number, min: 0.01, required: true },
    dimensions: { length: Number, width: Number, height: Number }, photos: { type: [String], default: [] },
    fragile: { type: Boolean, default: false }, specialHandlingNote: { type: String, default: "", maxlength: 500 },
  },
  serviceType: { type: String, enum: ["STANDARD", "EXPRESS"], required: true },
  protection: { type: Boolean, default: false },
  quote: { routeVersion: String, breakdown: { type: mongoose.Schema.Types.Mixed, required: true }, total: { type: Number, required: true, min: 0 }, expectedDelivery: String },
  status: { type: String, enum: ["DRAFT", "AWAITING_PAYMENT", "PAID", "AWAITING_PICKUP", "PICKUP_ASSIGNED", "PICKED_UP", "RECEIVED_AT_ORIGIN_HUB", "ADDITIONAL_PAYMENT_REQUIRED", "REFUND_REVIEW_REQUIRED", "VERIFIED_AT_ORIGIN_HUB", "READY_FOR_INTERSTATE_DISPATCH", "IN_TRANSIT", "ARRIVED_AT_DESTINATION_HUB", "DESTINATION_HUB_VERIFIED", "OUT_FOR_DELIVERY", "READY_FOR_COLLECTION", "DELIVERY_ATTEMPTED", "DELIVERED", "FAILED_DELIVERY", "RETURN_INITIATED", "RETURN_IN_TRANSIT", "RETURNED", "CANCELLED"], default: "DRAFT", index: true },
  paymentStatus: { type: String, enum: ["UNPAID", "PAID", "REFUNDED"], default: "UNPAID", index: true },
  paymentTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
  paymentIdempotencyKey: { type: String },
  assignedRiderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  transportTripId: { type: mongoose.Schema.Types.ObjectId, ref: "TransportTrip", default: null, index: true },
  deliveryOtpId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDeliveryOtp", default: null },
  paidAt: Date, deliveredAt: Date, cancelledAt: Date,
  verifiedWeightKg: { type: Number, min: 0.01, default: null },
  priceAdjustments: [{ declaredWeightKg: Number, verifiedWeightKg: Number, previousTotal: Number, adjustedTotal: Number, difference: Number, actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, createdAt: { type: Date, default: Date.now }, settlementTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null } }],
}, { timestamps: true });
shipmentSchema.index({ customerId: 1, createdAt: -1 });
shipmentSchema.index({ assignedRiderId: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ orderType: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ "trackingEmail.status": 1, "trackingEmail.nextAttemptAt": 1 });
shipmentSchema.index({ officeIdempotencyKey: 1 }, {
  unique: true, name: "officeIdempotencyKey_string_unique",
  partialFilterExpression: { officeIdempotencyKey: { $type: "string" } },
});
shipmentSchema.index({ originBranchId: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ destinationBranchId: 1, status: 1, createdAt: -1 });
shipmentSchema.index(
  { paymentIdempotencyKey: 1 },
  {
    name: "paymentIdempotencyKey_1_string_unique",
    unique: true,
    partialFilterExpression: { paymentIdempotencyKey: { $type: "string" } },
  },
);
module.exports = mongoose.model("InterstateShipment", shipmentSchema);