const mongoose = require("mongoose");

const empowermentProgramSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
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

    eligibilityRequirements: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: "",
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

    beneficiaryCount: {
      type: Number,
      default: 0,
      min: 0,
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

    totalDisbursed: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalFundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalFunded: {
      type: Number,
      default: 0,
      min: 0,
    },

    availableFundingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    remainingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastFundedAt: {
      type: Date,
      default: null,
    },

    lastFundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

    disbursementDate: {
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

empowermentProgramSchema.pre("save", function () {
  const calculatedBudget =
    Number(this.amountPerBeneficiary || 0) *
    Number(this.targetBeneficiaries || 0);

  if (calculatedBudget > 0) {
    this.totalBudget = calculatedBudget;
  }
});

empowermentProgramSchema.index({
  createdBy: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "EmpowermentProgram",
  empowermentProgramSchema
);
