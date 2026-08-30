const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      enum: [
        "GENERAL",
        "DELIVERY",
        "TRANSFER",
        "WALLET",
        "AIRTIME",
        "DATA",
        "CABLE",
        "ELECTRICITY",
        "EXAM_PIN",
        "ID_VERIFICATION",
        "GROUP_WALLET",
        "SOLAR",
        "PHONE",
        "TRUST",
        "BUSINESS_PARTNER",
        "SECURITY",
        "KYC",
        "ACCOUNT",
        "MARKETPLACE",
        "WITHDRAWAL",
        "PAYMENT",
        "SYSTEM",
      ],
      default: "GENERAL",
    },

    category: {
      type: String,
      enum: ["TRANSACTION", "SECURITY", "ACCOUNT", "OTHER"],
      default: "OTHER",
      index: true,
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    referenceType: {
      type: String,
      default: "",
      trim: true,
    },

    reference: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    relatedStatus: {
      type: String,
      default: "",
      trim: true,
      maxlength: 50,
    },

    action: {
      type: String,
      enum: [
        "",
        "TRANSACTION",
        "KYC",
        "SECURITY",
        "DELIVERY",
        "MARKETPLACE",
        "SOLAR",
        "PHONE",
        "SUPPORT",
      ],
      default: "",
    },

    dedupeKey: {
      type: String,
      default: undefined,
      trim: true,
      maxlength: 300,
    },

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({
  userId: 1,
  createdAt: -1,
});
notificationSchema.index({
  userId: 1,
  category: 1,
  isRead: 1,
  createdAt: -1,
});
notificationSchema.index(
  { dedupeKey: 1 },
  {
    unique: true,
    sparse: true,
  }
);
notificationSchema.index(
  { userId: 1, referenceId: 1, referenceType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      referenceId: { $type: "objectId" },
      referenceType: "COMMUNICATION_CAMPAIGN",
    },
  }
);

module.exports = mongoose.model(
  "Notification",
  notificationSchema
);