const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| NIGERIA STATES AND FCT
|--------------------------------------------------------------------------
|
| ServicePay Delivery will be controlled state by state.
| All states start as NOT LIVE until Head Office activates them.
|
*/

const NIGERIA_DELIVERY_LOCATIONS = [
  {
    code: "ABIA",
    name: "Abia",
  },
  {
    code: "ADAMAWA",
    name: "Adamawa",
  },
  {
    code: "AKWA_IBOM",
    name: "Akwa Ibom",
  },
  {
    code: "ANAMBRA",
    name: "Anambra",
  },
  {
    code: "BAUCHI",
    name: "Bauchi",
  },
  {
    code: "BAYELSA",
    name: "Bayelsa",
  },
  {
    code: "BENUE",
    name: "Benue",
  },
  {
    code: "BORNO",
    name: "Borno",
  },
  {
    code: "CROSS_RIVER",
    name: "Cross River",
  },
  {
    code: "DELTA",
    name: "Delta",
  },
  {
    code: "EBONYI",
    name: "Ebonyi",
  },
  {
    code: "EDO",
    name: "Edo",
  },
  {
    code: "EKITI",
    name: "Ekiti",
  },
  {
    code: "ENUGU",
    name: "Enugu",
  },
  {
    code: "FCT_ABUJA",
    name: "FCT Abuja",
  },
  {
    code: "GOMBE",
    name: "Gombe",
  },
  {
    code: "IMO",
    name: "Imo",
  },
  {
    code: "JIGAWA",
    name: "Jigawa",
  },
  {
    code: "KADUNA",
    name: "Kaduna",
  },
  {
    code: "KANO",
    name: "Kano",
  },
  {
    code: "KATSINA",
    name: "Katsina",
  },
  {
    code: "KEBBI",
    name: "Kebbi",
  },
  {
    code: "KOGI",
    name: "Kogi",
  },
  {
    code: "KWARA",
    name: "Kwara",
  },
  {
    code: "LAGOS",
    name: "Lagos",
  },
  {
    code: "NASARAWA",
    name: "Nasarawa",
  },
  {
    code: "NIGER",
    name: "Niger",
  },
  {
    code: "OGUN",
    name: "Ogun",
  },
  {
    code: "ONDO",
    name: "Ondo",
  },
  {
    code: "OSUN",
    name: "Osun",
  },
  {
    code: "OYO",
    name: "Oyo",
  },
  {
    code: "PLATEAU",
    name: "Plateau",
  },
  {
    code: "RIVERS",
    name: "Rivers",
  },
  {
    code: "SOKOTO",
    name: "Sokoto",
  },
  {
    code: "TARABA",
    name: "Taraba",
  },
  {
    code: "YOBE",
    name: "Yobe",
  },
  {
    code: "ZAMFARA",
    name: "Zamfara",
  },
];

const deliveryCoverageSchema =
  new mongoose.Schema(
    {
      stateCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true,
      },

      stateName: {
        type: String,
        required: true,
        unique: true,
        trim: true,
      },

      /*
       * false means ServicePay Delivery has not
       * launched in the state yet.
       */
      isLive: {
        type: Boolean,
        default: true,
        index: true,
      },

      /*
       * Optional message shown to customers when
       * delivery is not available in the state.
       */
      unavailableMessage: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },

      /*
       * Optional estimated launch information.
       */
      expectedLaunchDate: {
        type: Date,
        default: null,
      },

      activatedAt: {
        type: Date,
        default: null,
      },

      activatedBy: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      deactivatedAt: {
        type: Date,
        default: null,
      },

      deactivatedBy: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
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

deliveryCoverageSchema.index({
  isLive: 1,
  stateName: 1,
});

/*
 * Customer-friendly response.
 */
deliveryCoverageSchema.methods.toPublicJSON =
  function () {
    return {
      id: this._id,
      stateCode: this.stateCode,
      stateName: this.stateName,
      isLive: this.isLive === true,

      unavailableMessage:
        this.unavailableMessage ||
        (
          `ServicePay Delivery is not yet available in ` +
          `${this.stateName}. We will notify you when the service becomes live.`
        ),

      expectedLaunchDate:
        this.expectedLaunchDate,

      activatedAt:
        this.activatedAt,
    };
  };

const DeliveryCoverage =
  mongoose.model(
    "DeliveryCoverage",
    deliveryCoverageSchema
  );

module.exports = DeliveryCoverage;

module.exports.NIGERIA_DELIVERY_LOCATIONS =
  NIGERIA_DELIVERY_LOCATIONS;