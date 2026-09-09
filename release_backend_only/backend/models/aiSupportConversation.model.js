const mongoose = require("mongoose");

const aiSupportMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["USER", "ASSISTANT"],
      required: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const aiSupportConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    messages: {
      type: [aiSupportMessageSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "AISupportConversation",
  aiSupportConversationSchema
);