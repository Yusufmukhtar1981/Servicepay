const mongoose = require("mongoose");

const miniAppSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    category: {
      type: String,
      default: "Services",
      trim: true,
    },

    icon: {
      type: String,
      default: "apps",
    },

    routeKey: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "COMING_SOON", "DISABLED"],
      default: "ACTIVE",
    },

    featured: {
      type: Boolean,
      default: false,
    },

    systemApp: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 100,
    },
  },
  {
    timestamps: true,
  }
);

miniAppSchema.index({
  status: 1,
  sortOrder: 1,
});

module.exports =
  mongoose.models.MiniApp ||
  mongoose.model("MiniApp", miniAppSchema);
