const mongoose = require("mongoose");

// Deliberately append-only: winner marking is a controlled administrative
// action and there is no update path for this model.
const winnerSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      immutable: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    markedAt: { type: Date, default: Date.now, immutable: true },
  },
  { timestamps: false, strict: true }
);

winnerSchema.index({ announcementId: 1, customerId: 1 }, { unique: true });
winnerSchema.index({ announcementId: 1, markedAt: 1, _id: 1 });

const rejectMutation = function rejectMutation(next) {
  next(new Error("Campaign winner history is immutable."));
};
winnerSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"],
  rejectMutation,
);

module.exports = mongoose.model("AnnouncementCampaignWinner", winnerSchema);