const mongoose = require('mongoose');

const marketplaceOrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MarketplaceProduct',
      required: true,
    },

    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: true,
  }
);

const marketplaceOrderSchema = new mongoose.Schema(
  {
    orderReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    assignedSupportOfficer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    supportAssignedAt: { type: Date, default: null },
    supportAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    supportAssignmentVersion: { type: Number, default: 0, min: 0 },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },

    items: {
      type: [marketplaceOrderItemSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'Marketplace order must contain at least one item.',
      },
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },

    deliveryAddress: {
      type: String,
      required: true,
      trim: true,
    },

    state: {
      type: String,
      default: '',
      trim: true,
    },

    lga: {
      type: String,
      default: '',
      trim: true,
    },

    deliveryNote: {
      type: String,
      default: '',
      trim: true,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: [
        'WALLET',
        'BANK_TRANSFER',
        'CARD',
        'PAY_ON_DELIVERY',
        'NOT_SELECTED',
      ],
      default: 'NOT_SELECTED',
    },

    paymentStatus: {
      type: String,
      enum: [
        'PENDING',
        'PAID',
        'FAILED',
        'REFUNDED',
      ],
      default: 'PENDING',
      index: true,
    },

    orderStatus: {
      type: String,
      enum: [
        'PENDING',
        'PAID',
        'ACCEPTED',
        'PENDING_PAYMENT',
        'PLACED',
        'CONFIRMED',
        'PROCESSING',
        'READY',
        'SHIPPED',
        'READY_FOR_DELIVERY',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED',
      ],
      default: 'PENDING',
      index: true,
    },

    idempotencyKey: {
      type: String,
      trim: true,
    },

    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },

    ledgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LedgerEntry',
      default: null,
    },

    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },

    fundsStatus: {
      type: String,
      enum: ['HELD', 'SETTLED', 'REFUNDED'],
      default: 'HELD',
      index: true,
    },

    settlementLedgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LedgerEntry',
      default: null,
    },

    refundLedgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LedgerEntry',
      default: null,
    },

    deliveryConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deliveryConfirmedAt: {
      type: Date,
      default: null,
    },

    settledAt: {
      type: Date,
      default: null,
    },

    refundedAt: {
      type: Date,
      default: null,
    },

    statusHistory: {
      type: [
        {
          status: {
            type: String,
            required: true,
            trim: true,
          },
          changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
          },
          changedAt: {
            type: Date,
            default: Date.now,
          },
          note: {
            type: String,
            trim: true,
            default: '',
          },
        },
      ],
      default: [],
    },

    paidAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

marketplaceOrderSchema.index({
  buyer: 1,
  createdAt: -1,
});
marketplaceOrderSchema.index({ branchId: 1, createdAt: -1 });

marketplaceOrderSchema.index({
  'items.merchant': 1,
  createdAt: -1,
});

marketplaceOrderSchema.index(
  {
    buyer: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
    },
  }
);

module.exports = mongoose.model(
  'MarketplaceOrder',
  marketplaceOrderSchema
);
