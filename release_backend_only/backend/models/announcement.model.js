const mongoose = require("mongoose");

const announcementSchema =
  new mongoose.Schema(
    {
      title: {
        type: String,
        trim: true,
        default: "Servicepay Update",
        maxlength: 100,
      },

      message: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },

      isActive: {
        type: Boolean,
        default: false,
      },

      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "Announcement",
  announcementSchema
);