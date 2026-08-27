const mongoose = require("mongoose");

const deliveryAlertDispatchSchema = new mongoose.Schema(
  {
    assignmentEventId: { type: String, required: true },
    type: {
      type: String,
      enum: ["DELIVERY_ASSIGNED", "DELIVERY_ASSIGNMENT_CANCELLED"],
      required: true,
    },
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["CLAIMED", "SENT", "SKIPPED", "FAILED"],
      default: "CLAIMED",
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

deliveryAlertDispatchSchema.index(
  { assignmentEventId: 1, type: 1, riderId: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "DeliveryAlertDispatch",
  deliveryAlertDispatchSchema
);