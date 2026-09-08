const mongoose = require("mongoose");

const kekeFareSettingSchema =
  new mongoose.Schema(
    {
      /*
       * =====================================================
       * SCOPE
       * =====================================================
       *
       * GLOBAL = default pricing for everywhere.
       * STATE  = override for a specific state.
       */
      scopeType: {
        type: String,
        enum: [
          "GLOBAL",
          "STATE",
        ],
        default: "GLOBAL",
        index: true,
      },

      state: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
        index: true,
      },

      /*
       * =====================================================
       * FARE
       * =====================================================
       */

      baseFare: {
        type: Number,
        default: 250,
        min: 0,
      },

      minimumFare: {
        type: Number,
        default: 300,
        min: 0,
      },

      pricePerKm: {
        type: Number,
        default: 120,
        min: 0,
      },

      waitingFeePerMinute: {
        type: Number,
        default: 20,
        min: 0,
      },

      /*
       * =====================================================
       * SERVICEPAY COMMISSION
       * =====================================================
       */

      servicePayCommissionPercent: {
        type: Number,
        default: 10,
        min: 0,
        max: 100,
      },

      /*
       * =====================================================
       * LIMITS / STATUS
       * =====================================================
       */

      maxSearchDistanceKm: {
        type: Number,
        default: 15,
        min: 1,
        max: 100,
      },

      driverOfferSeconds: {
        type: Number,
        default: 60,
        min: 10,
        max: 300,
      },

      active: {
        type: Boolean,
        default: true,
        index: true,
      },

      /*
       * =====================================================
       * AUDIT
       * =====================================================
       */

      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

/*
 * Only one global setting should exist.
 */
kekeFareSettingSchema.index(
  {
    scopeType: 1,
    state: 1,
  },
  {
    unique: true,
    name:
      "keke_fare_scope_unique",
  }
);

module.exports =
  mongoose.model(
    "KekeFareSetting",
    kekeFareSettingSchema
  );