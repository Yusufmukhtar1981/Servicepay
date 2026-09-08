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
        'PENDING_PAYMENT',
        'PLACED',
        'CONFIRMED',
        'PROCESSING',
        'READY_FOR_DELIVERY',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED',
      ],
      default: 'PENDING_PAYMENT',
      index: true,
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

marketplaceOrderSchema.index({
  'items.merchant': 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  'MarketplaceOrder',
  marketplaceOrderSchema
);
