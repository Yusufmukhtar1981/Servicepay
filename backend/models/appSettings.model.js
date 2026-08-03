const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| SERVICE AVAILABILITY
|--------------------------------------------------------------------------
|
| Tsoffin fields masu “Enabled” an bar su domin existing controller
| da customer app su ci gaba da aiki.
|
| Sabbin services kuma suna nan domin complete Admin Settings.
|
*/

const servicesSchema =
  new mongoose.Schema(
    {
      /*
       * Legacy fields.
       */
      airtimeEnabled: {
        type: Boolean,
        default: true,
      },

      dataEnabled: {
        type: Boolean,
        default: true,
      },

      electricityEnabled: {
        type: Boolean,
        default: true,
      },

      ninVerificationEnabled: {
        type: Boolean,
        default: true,
      },

      /*
       * Complete service availability.
       */
      airtime: {
        type: Boolean,
        default: true,
      },

      data: {
        type: Boolean,
        default: true,
      },

      electricity: {
        type: Boolean,
        default: true,
      },

      cableTv: {
        type: Boolean,
        default: true,
      },

      examPin: {
        type: Boolean,
        default: true,
      },

      ninVerification: {
        type: Boolean,
        default: true,
      },

      bvnVerification: {
        type: Boolean,
        default: false,
      },

      delivery: {
        type: Boolean,
        default: true,
      },

      walletFunding: {
        type: Boolean,
        default: true,
      },

      servicepayTransfer: {
        type: Boolean,
        default: true,
      },

      bankTransfer: {
        type: Boolean,
        default: false,
      },

      flightBooking: {
        type: Boolean,
        default: false,
      },

      notifications: {
        type: Boolean,
        default: true,
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| ELECTRICITY SETTINGS
|--------------------------------------------------------------------------
|
| Waɗannan tsoffin fields ɗin ake amfani da su yanzu.
|
*/

const electricitySettingsSchema =
  new mongoose.Schema(
    {
      minimumAmount: {
        type: Number,
        default: 1000,
        min: 0,
      },

      maximumAmount: {
        type: Number,
        default: 200000,
        min: 1,
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| PLATFORM SETTINGS
|--------------------------------------------------------------------------
|
| platform.maintenanceMode tsohon controller ne yake amfani da shi.
|
*/

const platformSettingsSchema =
  new mongoose.Schema(
    {
      maintenanceMode: {
        type: Boolean,
        default: false,
      },

      maintenanceTitle: {
        type: String,
        trim: true,
        default:
          "ServicePay Maintenance",
      },

      maintenanceMessage: {
        type: String,
        trim: true,
        default:
          "ServicePay is temporarily unavailable while we perform an important update. Please try again shortly.",
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| KYC SETTINGS
|--------------------------------------------------------------------------
*/

const kycSettingsSchema =
  new mongoose.Schema(
    {
      requiredForRegistration: {
        type: Boolean,
        default: false,
      },

      requiredAfterRegistration: {
        type: Boolean,
        default: true,
      },

      requiredForWalletFunding: {
        type: Boolean,
        default: true,
      },

      requiredForServicepayTransfer: {
        type: Boolean,
        default: true,
      },

      requiredForBankTransfer: {
        type: Boolean,
        default: true,
      },

      requiredForHighValueTransactions: {
        type: Boolean,
        default: true,
      },

      acceptedIdentityType: {
        type: String,
        enum: [
          "NIN",
          "BVN",
          "NIN_OR_BVN",
          "NIN_AND_BVN",
        ],
        default: "NIN_OR_BVN",
      },

      unverifiedCustomerCanUseBasicServices: {
        type: Boolean,
        default: true,
      },

      unverifiedCustomerDailyLimit: {
        type: Number,
        default: 5000,
        min: 0,
      },

      highValueTransactionThreshold: {
        type: Number,
        default: 50000,
        min: 0,
      },

      minimumAge: {
        type: Number,
        default: 18,
        min: 0,
        max: 100,
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| REGISTRATION SETTINGS
|--------------------------------------------------------------------------
*/

const registrationSettingsSchema =
  new mongoose.Schema(
    {
      registrationEnabled: {
        type: Boolean,
        default: true,
      },

      requireEmail: {
        type: Boolean,
        default: false,
      },

      requirePhoneVerification: {
        type: Boolean,
        default: false,
      },

      requireEmailVerification: {
        type: Boolean,
        default: false,
      },

      requireNinOrBvnAfterRegistration: {
        type: Boolean,
        default: true,
      },

      allowReferralCode: {
        type: Boolean,
        default: true,
      },

      defaultCustomerStatus: {
        type: String,
        enum: [
          "ACTIVE",
          "SUSPENDED",
          "BLOCKED",
        ],
        default: "ACTIVE",
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| TRANSACTION LIMITS
|--------------------------------------------------------------------------
*/

const transactionLimitsSchema =
  new mongoose.Schema(
    {
      minimumWalletFunding: {
        type: Number,
        default: 100,
        min: 0,
      },

      maximumWalletFunding: {
        type: Number,
        default: 500000,
        min: 0,
      },

      minimumServicepayTransfer: {
        type: Number,
        default: 100,
        min: 0,
      },

      maximumServicepayTransfer: {
        type: Number,
        default: 500000,
        min: 0,
      },

      dailyServicepayTransferLimit: {
        type: Number,
        default: 1000000,
        min: 0,
      },

      minimumBankTransfer: {
        type: Number,
        default: 100,
        min: 0,
      },

      maximumBankTransfer: {
        type: Number,
        default: 50000,
        min: 0,
      },

      dailyBankTransferLimit: {
        type: Number,
        default: 200000,
        min: 0,
      },

      minimumAirtimePurchase: {
        type: Number,
        default: 50,
        min: 0,
      },

      maximumAirtimePurchase: {
        type: Number,
        default: 50000,
        min: 0,
      },

      maximumDataPurchase: {
        type: Number,
        default: 100000,
        min: 0,
      },

      maximumElectricityPayment: {
        type: Number,
        default: 200000,
        min: 0,
      },

      maximumCableTvPayment: {
        type: Number,
        default: 200000,
        min: 0,
      },

      dailyCustomerTransactionLimit: {
        type: Number,
        default: 1000000,
        min: 0,
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| SUPPORT SETTINGS
|--------------------------------------------------------------------------
|
| support.phone da support.email an bar su domin tsohon controller.
|
*/

const supportSettingsSchema =
  new mongoose.Schema(
    {
      /*
       * Legacy fields.
       */
      phone: {
        type: String,
        trim: true,
        default: "08000000000",
      },

      email: {
        type: String,
        trim: true,
        lowercase: true,
        default:
          "support@servicepay.ng",
      },

      /*
       * Complete fields.
       */
      supportPhone: {
        type: String,
        trim: true,
        default: "08000000000",
      },

      supportEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default:
          "support@servicepay.ng",
      },

      whatsappNumber: {
        type: String,
        trim: true,
        default: "",
      },

      officeAddress: {
        type: String,
        trim: true,
        default: "",
      },

      websiteUrl: {
        type: String,
        trim: true,
        default:
          "https://servicepay.ng",
      },

      privacyPolicyUrl: {
        type: String,
        trim: true,
        default: "",
      },

      termsAndConditionsUrl: {
        type: String,
        trim: true,
        default: "",
      },

      supportAvailableFrom: {
        type: String,
        trim: true,
        default: "08:00",
      },

      supportAvailableTo: {
        type: String,
        trim: true,
        default: "18:00",
      },

      supportDays: {
        type: [String],
        default: [
          "MONDAY",
          "TUESDAY",
          "WEDNESDAY",
          "THURSDAY",
          "FRIDAY",
          "SATURDAY",
        ],
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| APP VERSION SETTINGS
|--------------------------------------------------------------------------
*/

const appVersionSettingsSchema =
  new mongoose.Schema(
    {
      minimumSupportedVersion: {
        type: String,
        trim: true,
        default: "1.0.0",
      },

      latestVersion: {
        type: String,
        trim: true,
        default: "1.0.0",
      },

      forceUpdate: {
        type: Boolean,
        default: false,
      },

      updateMessage: {
        type: String,
        trim: true,
        default:
          "A new version of ServicePay is available. Please update your app.",
      },

      androidUpdateUrl: {
        type: String,
        trim: true,
        default: "",
      },

      iosUpdateUrl: {
        type: String,
        trim: true,
        default: "",
      },
    },
    {
      _id: false,
    }
  );

/*
|--------------------------------------------------------------------------
| MAIN APPLICATION SETTINGS
|--------------------------------------------------------------------------
*/

const appSettingsSchema =
  new mongoose.Schema(
    {
      /*
       * Keep GLOBAL_SETTINGS so current
       * controller and database continue working.
       */
      key: {
        type: String,
        default: "GLOBAL_SETTINGS",
        unique: true,
        trim: true,
        uppercase: true,
        required: true,
      },

      applicationName: {
        type: String,
        trim: true,
        default: "ServicePay",
      },

      applicationSlogan: {
        type: String,
        trim: true,
        default:
          "One Platform, Many Solutions.",
      },

      currency: {
        type: String,
        trim: true,
        uppercase: true,
        default: "NGN",
      },

      currencySymbol: {
        type: String,
        trim: true,
        default: "₦",
      },

      services: {
        type: servicesSchema,
        default: () => ({}),
      },

      electricity: {
        type: electricitySettingsSchema,
        default: () => ({}),
      },

      platform: {
        type: platformSettingsSchema,
        default: () => ({}),
      },

      kyc: {
        type: kycSettingsSchema,
        default: () => ({}),
      },

      registration: {
        type: registrationSettingsSchema,
        default: () => ({}),
      },

      transactionLimits: {
        type: transactionLimitsSchema,
        default: () => ({}),
      },

      support: {
        type: supportSettingsSchema,
        default: () => ({}),
      },

      appVersion: {
        type: appVersionSettingsSchema,
        default: () => ({}),
      },

      updatedBy: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      lastUpdatedBy: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        default: null,
      },

      lastUpdatedByName: {
        type: String,
        trim: true,
        default: "",
      },

      lastUpdateReason: {
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
|--------------------------------------------------------------------------
| SYNCHRONIZE LEGACY AND NEW FIELDS
|--------------------------------------------------------------------------
|
| Wannan yana tabbatar da cewa tsohon controller da sabon Admin Settings
| suna ganin values iri ɗaya.
|
*/

appSettingsSchema.pre(
  "save",
  function () {
    if (this.services) {
      if (
        this.isModified(
          "services.airtimeEnabled"
        )
      ) {
        this.services.airtime =
          this.services.airtimeEnabled;
      } else if (
        this.isModified(
          "services.airtime"
        )
      ) {
        this.services.airtimeEnabled =
          this.services.airtime;
      }

      if (
        this.isModified(
          "services.dataEnabled"
        )
      ) {
        this.services.data =
          this.services.dataEnabled;
      } else if (
        this.isModified(
          "services.data"
        )
      ) {
        this.services.dataEnabled =
          this.services.data;
      }

      if (
        this.isModified(
          "services.electricityEnabled"
        )
      ) {
        this.services.electricity =
          this.services
            .electricityEnabled;
      } else if (
        this.isModified(
          "services.electricity"
        )
      ) {
        this.services
          .electricityEnabled =
          this.services.electricity;
      }

      if (
        this.isModified(
          "services.ninVerificationEnabled"
        )
      ) {
        this.services.ninVerification =
          this.services
            .ninVerificationEnabled;
      } else if (
        this.isModified(
          "services.ninVerification"
        )
      ) {
        this.services
          .ninVerificationEnabled =
          this.services.ninVerification;
      }
    }

    if (this.support) {
      if (
        this.isModified(
          "support.phone"
        )
      ) {
        this.support.supportPhone =
          this.support.phone;
      } else if (
        this.isModified(
          "support.supportPhone"
        )
      ) {
        this.support.phone =
          this.support.supportPhone;
      }

      if (
        this.isModified(
          "support.email"
        )
      ) {
        this.support.supportEmail =
          this.support.email;
      } else if (
        this.isModified(
          "support.supportEmail"
        )
      ) {
        this.support.email =
          this.support.supportEmail;
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET OR CREATE GLOBAL SETTINGS
|--------------------------------------------------------------------------
*/

appSettingsSchema.statics
  .getGlobalSettings =
  async function () {
    let settings =
      await this.findOne({
        key: "GLOBAL_SETTINGS",
      });

    if (!settings) {
      settings =
        await this.create({
          key: "GLOBAL_SETTINGS",
        });
    }

    return settings;
  };

module.exports = mongoose.model(
  "AppSettings",
  appSettingsSchema
);