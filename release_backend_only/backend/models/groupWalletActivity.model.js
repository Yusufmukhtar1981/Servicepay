const mongoose = require("mongoose");

const groupWalletActivitySchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupWallet",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "GROUP_CREATED",
        "MEMBER_ADDED",
        "MEMBER_REMOVED",
        "MEMBER_LEFT",
        "GROUP_PAUSED",
        "GROUP_RESUMED",
        "GROUP_COMPLETED",
        "GROUP_CANCELLED",
        "CONTRIBUTION_SUCCESSFUL",
      ],
      required: true,
      index: true,
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    contribution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupContribution",
      default: null,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

groupWalletActivitySchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("GroupWalletActivity", groupWalletActivitySchema);