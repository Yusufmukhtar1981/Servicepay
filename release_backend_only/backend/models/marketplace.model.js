const mongoose = require('mongoose');

const marketplaceProductSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Null is deliberately reserved for legacy/global inventory. New stock is
    // stamped from the authenticated merchant, never from a request payload.
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },

    merchantName: {
      type: String,
      trim: true,
      required: true,
    },

    title: {
      type: String,
      trim: true,
      required: true,
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    category: {
      type: String,
      trim: true,
      default: 'General',
      index: true,
    },

    price: {
      type: Number,
      min: 0,
      required: true,
    },

    stock: {
      type: Number,
      min: 0,
      default: 0,
    },

    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },

    imageUrls: {
      type: [String],
      default: [],
    },

    sku: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    brand: {
      type: String,
      trim: true,
      default: '',
    },

    condition: {
      type: String,
      trim: true,
      default: '',
    },

    weight: {
      type: String,
      trim: true,
      default: '',
    },

    state: {
      type: String,
      trim: true,
      default: '',
    },

    lga: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'],
      default: 'PENDING',
      index: true,
    },

    featured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

marketplaceProductSchema.index({
  title: 'text',
  description: 'text',
  category: 'text',
  merchantName: 'text',
});

marketplaceProductSchema.index({
  merchant: 1,
  status: 1,
  createdAt: -1,
});
marketplaceProductSchema.index({ branchId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model(
  'MarketplaceProduct',
  marketplaceProductSchema
);
