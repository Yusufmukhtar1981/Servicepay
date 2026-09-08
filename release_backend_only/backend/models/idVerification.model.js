const mongoose = require("mongoose");

const verificationDataSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      default: "",
    },

    firstName: {
      type: String,
      default: "",
    },

    middleName: {
      type: String,
      default: "",
    },

    lastName: {
      type: String,
      default: "",
    },

    nin: {
      type: String,
      default: "",
    },

    bvn: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      default: "",
    },

    gender: {
      type: String,
      default: "",
    },

    dateOfBirth: {
      type: String,
      default: "",
    },

    address: {
      type: String,
      default: "",
    },

    stateOfOrigin: {
      type: String,
      default: "",
    },

    lga: {
      type: String,
      default: "",
    },

    photo: {
      type: String,
      default: "",
    },

    nationality: {
      type: String,
      default: "",
    },

    dateOfIssue: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  },
);

const idVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    idType: {
      type: String,
      enum: ["NIN", "BVN", "DRIVER_LICENSE", "PASSPORT", "VOTER_CARD"],
      default: "NIN",
      index: true,
    },

    searchType: {
      type: String,
      enum: ["NIN_NUMBER", "PHONE_NUMBER", "DEMOGRAPHIC", "BVN_NUMBER"],
      default: "NIN_NUMBER",
    },

    slipType: {
      type: String,
      // Legacy NIN values remain readable for existing records, and BASIC is
      // still used by BVN. New NIN writes are forced to PREMIUM in the
      // controller.
      enum: ["PREMIUM", "STANDARD", "REGULAR", "INFORMATION", "BASIC"],
      default: "PREMIUM",
    },

    reference: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },

    amountCharged: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["PENDING", "SUCCESSFUL", "FAILED"],
      default: "PENDING",
      index: true,
    },

    /*
     * Kept for compatibility with existing NIN records.
     */
    ninNumberMasked: {
      type: String,
      default: "",
    },

    /*
     * Used for BVN verification records.
     */
    bvnNumberMasked: {
      type: String,
      default: "",
    },

    /*
     * General masked ID field for future ID types.
     */
    idNumberMasked: {
      type: String,
      default: "",
    },

    consentAccepted: {
      type: Boolean,
      default: false,
    },

    verificationData: {
      type: verificationDataSchema,
      default: () => ({}),
    },

    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },

    failureReason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

idVerificationSchema.index({
  userId: 1,
  idType: 1,
  createdAt: -1,
});

module.exports = mongoose.model("IdVerification", idVerificationSchema);
