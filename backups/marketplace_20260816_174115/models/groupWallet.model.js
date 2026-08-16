const mongoose = require("mongoose");

const groupWalletSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    contributionAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    frequency: {
      type: String,
      enum: ["DAILY", "WEEKLY", "MONTHLY"],
      default: "MONTHLY",
    },

    members: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },

        phone: String,

        status: {
          type: String,
          enum: ["INVITED", "ACTIVE"],
          default: "INVITED",
        },
      },
    ],

    totalCollected: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "CLOSED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "GroupWallet",
  groupWalletSchema
);
