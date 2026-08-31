const mongoose = require("mongoose");

const empowermentAuditLogSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },
    action: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: [
        "ORGANIZATION",
        "PROGRAM",
        "BENEFICIARY",
        "FUNDING",
        "DISBURSEMENT",
      ],
      required: true,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentProgram",
      default: null,
      index: true,
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reference: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

empowermentAuditLogSchema.index({ program: 1, createdAt: -1 });

module.exports = mongoose.model(
  "EmpowermentAuditLog",
  empowermentAuditLogSchema
);