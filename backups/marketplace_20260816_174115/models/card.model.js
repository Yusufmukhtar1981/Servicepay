const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    cardType: {
      type: String,
      enum: ['PHYSICAL', 'VIRTUAL'],
      required: true,
    },

    status: {
      type: String,
      enum: [
        'PENDING',
        'APPROVED',
        'PROCESSING',
        'ACTIVE',
        'FROZEN',
        'BLOCKED',
        'REJECTED',
        'EXPIRED',
      ],
      default: 'PENDING',
    },

    cardBrand: {
      type: String,
      default: 'ServicePay',
    },

    cardNetwork: {
      type: String,
      enum: ['VERVE', 'VISA', 'MASTERCARD', 'OTHER'],
      default: 'VERVE',
    },

    currency: {
      type: String,
      default: 'NGN',
    },

    maskedPan: {
      type: String,
      default: '',
    },

    last4: {
      type: String,
      default: '',
    },

    expiryMonth: {
      type: String,
      default: '',
    },

    expiryYear: {
      type: String,
      default: '',
    },

    provider: {
      type: String,
      default: '',
    },

    providerCardId: {
      type: String,
      default: '',
    },

    deliveryAddress: {
      type: String,
      default: '',
    },

    state: {
      type: String,
      default: '',
    },

    lga: {
      type: String,
      default: '',
    },

    requestReference: {
      type: String,
      
      index: true,
    },

    rejectionReason: {
      type: String,
      default: '',
    },

    activatedAt: Date,
    frozenAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Card', cardSchema);
