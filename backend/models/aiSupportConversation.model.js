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
    language: { type: String, enum: ["en", "ha"], default: "en" },

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
    expiresAt: { type: Date, index: { expires: 0 } },
    lastResponseMs: { type: Number, min: 0, default: 0 },
    responseCount: { type: Number, min: 0, default: 0 },
    responseTotalMs: { type: Number, min: 0, default: 0 },
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, maxlength: 500, default: "" },
      updatedAt: Date,
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