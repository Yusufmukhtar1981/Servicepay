const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| RIDER WITHDRAWAL MODEL
|--------------------------------------------------------------------------
|
| This model stores every Rider commission-withdrawal request.
|
| PENDING:
| Rider submitted the request and the money is locked.
|
| APPROVED:
| Head Office approved the request for payment.
|
| PROCESSING:
| Payment has been sent to the payment provider.
|
| PAID:
| Rider has been paid successfully.
|
| REJECTED:
| Head Office rejected the request and the money was returned.
|
| FAILED:
| Payment failed and the money was returned.
|
| CANCELLED:
| Request was cancelled before payment.
|
*/

const riderWithdrawalSchema =
  new mongoose.Schema(
    {
      riderId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      reference: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true,
      },

      amount: {
        type: Number,
        required: true,
        min: 0,
      },

      fee: {
        type: Number,
        default: 0,
        min: 0,
      },

      totalDebit: {
        type: Number,
        required: true,
        min: 0,
      },

      currency: {
        type: String,
        uppercase: true,
        trim: true,
        default: "NGN",
      },

      bankCode: {
        type: String,
        required: true,
        trim: true,
      },

      bankName: {
        type: String,
        required: true,
        trim: true,
      },

      accountNumber: {
        type: String,
        required: true,
        trim: true,
      },

      accountName: {
        type: String,
        required: true,
        trim: true,
      },

      narration: {
        type: String,
        trim: true,
        default:
          "ServicePay Rider commission withdrawal",
        maxlength: 120,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "APPROVED",
          "PROCESSING",
          "PAID",
          "REJECTED",
          "FAILED",
          "CANCELLED",
        ],
        default: "PENDING",
        index: true,
      },

      /*
       * This records whether the requested amount
       * has been removed from pendingRiderSettlement.
       */
      fundsLocked: {
        type: Boolean,
        default: true,
        index: true,
      },

      /*
       * This prevents rejected or failed withdrawals
       * from refunding the same amount twice.
       */
      fundsReturned: {
        type: Boolean,
        default: false,
        index: true,
      },

      requestedAt: {
        type: Date,
        default: Date.now,
        index: true,
      },

      approvedAt: {
        type: Date,
        default: null,
      },

      approvedBy: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      rejectedAt: {
        type: Date,
        default: null,
      },

      rejectedBy: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      rejectionReason: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },

      processingAt: {
        type: Date,
        default: null,
      },

      paidAt: {
        type: Date,
        default: null,
      },

      failedAt: {
        type: Date,
        default: null,
      },

      failureReason: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },

      cancelledAt: {
        type: Date,
        default: null,
      },

      reviewedAt: {
        type: Date,
        default: null,
      },

      reviewedBy: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      provider: {
        type: String,
        uppercase: true,
        trim: true,
        default: "MANUAL",
      },

      providerReference: {
        type: String,
        trim: true,
        default: "",
        index: true,
      },

      providerTransactionId: {
        type: String,
        trim: true,
        default: "",
      },

      providerStatus: {
        type: String,
        trim: true,
        uppercase: true,
        default: "",
      },

      providerResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },

      adminNote: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },
    },
    {
      timestamps: true,
    }
  );

/*
 * Rider withdrawal history.
 */
riderWithdrawalSchema.index({
  riderId: 1,
  createdAt: -1,
});

/*
 * Head Office pending withdrawal queue.
 */
riderWithdrawalSchema.index({
  status: 1,
  requestedAt: 1,
});

/*
 * Helps prevent multiple active withdrawals
 * using the same ServicePay reference.
 */
riderWithdrawalSchema.index({
  reference: 1,
  riderId: 1,
});

/*
 * Return a safe Rider-facing withdrawal object.
 */
riderWithdrawalSchema.methods.toRiderJSON =
  function () {
    return {
      id: this._id,

      reference:
        this.reference,

      amount:
        Number(this.amount || 0),

      fee:
        Number(this.fee || 0),

      totalDebit:
        Number(
          this.totalDebit || 0
        ),

      currency:
        this.currency,

      bank: {
        bankCode:
          this.bankCode,

        bankName:
          this.bankName,

        accountNumber:
          this.accountNumber,

        accountName:
          this.accountName,
      },

      narration:
        this.narration,

      status:
        this.status,

      requestedAt:
        this.requestedAt,

      approvedAt:
        this.approvedAt,

      rejectedAt:
        this.rejectedAt,

      rejectionReason:
        this.rejectionReason,

      processingAt:
        this.processingAt,

      paidAt:
        this.paidAt,

      failedAt:
        this.failedAt,

      failureReason:
        this.failureReason,

      provider:
        this.provider,

      providerReference:
        this.providerReference,

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,
    };
  };

module.exports = mongoose.model(
  "RiderWithdrawal",
  riderWithdrawalSchema
);