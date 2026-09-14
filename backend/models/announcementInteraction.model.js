const mongoose = require("mongoose");

/*
 * One durable state row per announcement/customer pair. Action timestamps are
 * immutable event markers: the unique pair and null checks in the controller
 * make retries idempotent and prevent duplicate metrics.
 */
const announcementInteractionSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    viewedAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    dismissedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
    // Used for EVERY_LOGIN without creating a second row per login.
    lastLoginKey: { type: String, default: null },
  },
  { timestamps: true }
);

announcementInteractionSchema.index(
  { announcementId: 1, customerId: 1 },
  { unique: true }
);
announcementInteractionSchema.index({ customerId: 1, updatedAt: -1 });

module.exports =
  mongoose.models.AnnouncementInteraction ||
  mongoose.model("AnnouncementInteraction", announcementInteractionSchema);