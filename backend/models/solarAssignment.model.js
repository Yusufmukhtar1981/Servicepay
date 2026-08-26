const mongoose = require("mongoose");

const solarAssignmentSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SolarApplication",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    officer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SolarOfficer",
      required: true,
      index: true,
    },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["ACTIVE", "REASSIGNED", "ENDED"],
      default: "ACTIVE",
      index: true,
    },
    note: { type: String, trim: true, default: "", maxlength: 500 },
    authorizationVersion: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

solarAssignmentSchema.index(
  { application: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);
solarAssignmentSchema.index({ officer: 1, status: 1, assignedAt: -1 });

module.exports = mongoose.model("SolarAssignment", solarAssignmentSchema);