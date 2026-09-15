const mongoose = require("mongoose");

const transactionSchema =
  new mongoose.Schema(
    {
      reference: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
      },

      customerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },

      agentId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      stateManagerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      zonalManagerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      serviceType: {
        type: String,
        enum: [
          "AIRTIME",
          "DATA",
          "CABLE",
          "ELECTRICITY",
          "EXAM_PIN",
          "WALLET_FUNDING",
          "TRANSFER",
          "BANK_TRANSFER",
          "DELIVERY",
          "ID_VERIFICATION",
          "AMANA",
          "EMPOWERMENT_FUNDING",
          "EMPOWERMENT_DISBURSEMENT",
          "MARKETPLACE",
          "REFERRAL_BONUS",
          "REFERRAL_BONUS_REVERSAL",
           "SOLAR_DEPOSIT",
           "SOLAR_INSTALLMENT",
           "PHONE_FINANCING_DEPOSIT",
           "PHONE_FINANCING_INSTALLMENT",
           "PHONE_FINANCING_REFUND",
           "PROTECTED_DEAL",
           "INTERSTATE_LOGISTICS",
        ],
        required: true,
        index: true,
      },

      provider: {
        type: String,
        trim: true,
        default: null,
      },

      phone: {
        type: String,
        trim: true,
        default: null,
      },

      amount: {
        type: Number,
        required: true,
        min: 0,
      },

      agentCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      stateManagerCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      zonalManagerCommission: {
        type: Number,
        default: 0,
        min: 0,
      },

      servicepayProfit: {
        type: Number,
        default: 0,
        min: 0,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "SUCCESSFUL",
          "FAILED",
          "REFUNDED",
        ],
        default: "PENDING",
        index: true,
      },

      providerResponse: {
        type:
          mongoose.Schema.Types.Mixed,
        default: null,
      },
      // Campaign tracking excludes successful records that were later
      // reversed. These references are optional for legacy transactions.
      reversalReference: { type: String, default: "" },
      reversalTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
        default: null,
      },
      reversedTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

transactionSchema.index({
  customerId: 1,
  createdAt: -1,
});
transactionSchema.index({ branchId: 1, createdAt: -1 });
transactionSchema.index({ createdAt: -1 });

transactionSchema.index({
  serviceType: 1,
  status: 1,
  createdAt: -1,
});

// Global campaign reports constrain status/service/date before grouping by
// customer; keep the date window before the grouping key in this index.
transactionSchema.index({
  status: 1,
  serviceType: 1,
  createdAt: 1,
  customerId: 1,
  _id: 1,
});

// Campaign progress always scopes by customer, successful status, service
// type, and the eligibility window. Keep the existing indexes intact.
transactionSchema.index({
  customerId: 1,
  status: 1,
  serviceType: 1,
  createdAt: 1,
});

transactionSchema.index({
  provider: 1,
  createdAt: -1,
});

transactionSchema.index({
  amount: 1,
  createdAt: -1,
});

/*
 * Reward money movements are terminal financial records. They may be
 * created once, but they must never be changed or deleted afterward. DATA
 * and other ordinary transactions retain their existing mutation behavior.
 */
const IMMUTABLE_REWARD_SERVICES = new Set([
  "REFERRAL_BONUS",
  "REFERRAL_BONUS_REVERSAL",
]);
const immutableRewardError = () =>
  new Error("Referral reward transactions are immutable and cannot be modified or deleted.");
const serviceFromUpdate = (update = {}) =>
  update?.serviceType || update?.$set?.serviceType || update?.$setOnInsert?.serviceType;

const guardRewardMutation = async function () {
  const query = this.getQuery?.() || {};
  const update = this.getUpdate?.() || {};
  if (IMMUTABLE_REWARD_SERVICES.has(String(query.serviceType || "").toUpperCase())) {
    throw immutableRewardError();
  }
  if (IMMUTABLE_REWARD_SERVICES.has(String(serviceFromUpdate(update) || "").toUpperCase())) {
    throw immutableRewardError();
  }
  const model = this.model || this;
  const hasImmutableReward = await model.exists({
    $and: [
      query,
      { serviceType: { $in: [...IMMUTABLE_REWARD_SERVICES] } },
    ],
  });
  if (hasImmutableReward) {
    throw immutableRewardError();
  }
};

transactionSchema.pre("save", function () {
  if (!this.isNew && IMMUTABLE_REWARD_SERVICES.has(String(this.serviceType || "").toUpperCase())) {
    throw immutableRewardError();
  }
});
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete"].forEach((operation) => {
  transactionSchema.pre(operation, { document: false, query: true }, guardRewardMutation);
});
transactionSchema.pre("deleteOne", { document: true, query: false }, function () {
  if (IMMUTABLE_REWARD_SERVICES.has(String(this.serviceType || "").toUpperCase())) {
    throw immutableRewardError();
  }
});
transactionSchema.pre("bulkWrite", async function (operations = []) {
  for (const operation of operations) {
    const payload = operation?.updateOne || operation?.updateMany || operation?.deleteOne || operation?.deleteMany || {};
    const serviceType =
      payload.filter?.serviceType ||
      payload.update?.serviceType ||
      payload.update?.$set?.serviceType ||
      payload.update?.$setOnInsert?.serviceType;
    if (IMMUTABLE_REWARD_SERVICES.has(String(serviceType || "").toUpperCase())) {
      throw immutableRewardError();
    }
    if (payload.filter) {
      const hasImmutableReward = await this.findOne({
        $and: [
          payload.filter,
          { serviceType: { $in: [...IMMUTABLE_REWARD_SERVICES] } },
        ],
      }).select("_id").lean();
      if (hasImmutableReward) throw immutableRewardError();
    }
  }
});

const Transaction =
  mongoose.model(
    "Transaction",
    transactionSchema
  );

module.exports = Transaction;