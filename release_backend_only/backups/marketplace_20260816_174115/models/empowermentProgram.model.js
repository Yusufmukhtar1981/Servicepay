const mongoose = require("mongoose");

const empowermentProgramSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmpowermentOrganization",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    programType: {
      type: String,
      enum: ["CASH_GRANT", "CONTROLLED_GRANT"],
      default: "CASH_GRANT",
    },

    targetGroup: {
      type: String,
      enum: [
        "YOUTH",
        "WOMEN",
        "FARMERS",
        "STUDENTS",
        "TRADERS",
        "ARTISANS",
        "GENERAL",
        "OTHER",
      ],
      default: "GENERAL",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    lga: {
      type: String,
      trim: true,
      default: "",
    },

    ward: {
      type: String,
      trim: true,
      default: "",
    },

    amountPerBeneficiary: {
      type: Number,
      required: true,
      min: 0,
    },

    targetBeneficiaries: {
      type: Number,
      required: true,
      min: 1,
    },

    totalBudget: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalApproved: {
      type: Number,
      default: 0,
    },

    totalPaid: {
      type: Number,
      default: 0,
    },

    totalDisbursedAmount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: [
        "DRAFT",
        "OPEN",
        "UNDER_REVIEW",
        "APPROVED",
        "DISBURSING",
        "COMPLETED",
        "SUSPENDED",
        "CANCELLED",
      ],
      default: "DRAFT",
      index: true,
    },

    startDate: {
      type: Date,
      default: null,
    },

    endDate: {
      type: Date,
      default: null,
    },

    publicApplicationEnabled: {
      type: Boolean,
      default: false,
    },

    publicTransparencyEnabled: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

empowermentProgramSchema.pre("save", function (next) {
  if (
    (!this.totalBudget || this.totalBudget <= 0) &&
    this.amountPerBeneficiary &&
    this.targetBeneficiaries
  ) {
    this.totalBudget =
      Number(this.amountPerBeneficiary) *
      Number(this.targetBeneficiaries);
  }

  next();
});

module.exports = mongoose.model(
  "EmpowermentProgram",
  empowermentProgramSchema
);
