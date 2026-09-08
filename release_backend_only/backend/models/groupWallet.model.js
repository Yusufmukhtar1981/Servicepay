const mongoose = require("mongoose");

const groupWalletSchema = new mongoose.Schema(
  {
    groupId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
      uppercase: true,
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    leaderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    groupName: {
      type: String,
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

        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          index: true,
        },

        fullName: {
          type: String,
          trim: true,
          default: "",
        },

        phone: String,

        role: {
          type: String,
          enum: ["LEADER", "MEMBER"],
          default: "MEMBER",
        },

        status: {
          type: String,
          enum: ["INVITED", "ACTIVE", "LEFT", "REMOVED"],
          default: "INVITED",
        },

        membershipStatus: {
          type: String,
          enum: ["INVITED", "ACTIVE", "LEFT", "REMOVED"],
        },

        joinedAt: {
          type: Date,
          default: null,
        },

        totalContributed: {
          type: Number,
          default: 0,
          min: 0,
        },

        contributionCount: {
          type: Number,
          default: 0,
          min: 0,
        },

        nextContributionStatus: {
          type: String,
          enum: ["DUE", "PAID", "NOT_DUE"],
          default: "DUE",
        },

        lastContributionDate: {
          type: Date,
          default: null,
        },

        dueNotificationCycle: {
          type: String,
          default: "",
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
      enum: ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "CLOSED"],
      default: "ACTIVE",
    },

    nextContributionDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

groupWalletSchema.index({
  "members.userId": 1,
  "members.membershipStatus": 1,
});

module.exports = mongoose.model(
  "GroupWallet",
  groupWalletSchema
);
