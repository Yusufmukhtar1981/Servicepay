const AppSettings =
  require("../models/appSettings.model");

/*
 * ServicePay Fintech Control
 *
 * Uses the EXISTING AppSettings collection.
 * No second settings collection is created.
 *
 * IMPORTANT:
 * These values are configuration only.
 * Operational enforcement comes after API testing.
 */

if (
  !AppSettings.schema.path(
    "fintechControl.maintenance.enabled"
  )
) {
  AppSettings.schema.add({
    fintechControl: {

      maintenance: {
        enabled: {
          type: Boolean,
          default: false,
        },

        customerAppEnabled: {
          type: Boolean,
          default: true,
        },

        apiEnabled: {
          type: Boolean,
          default: true,
        },

        message: {
          type: String,
          trim: true,
          maxlength: 500,
          default:
            "ServicePay is temporarily undergoing maintenance. Please try again shortly.",
        },

        scheduledStartAt: {
          type: Date,
          default: null,
        },

        scheduledEndAt: {
          type: Date,
          default: null,
        },
      },

      transactionFees: {
        servicepayTransfer: {
          type: Number,
          default: 0,
          min: 0,
        },

        bankTransfer: {
          type: Number,
          default: 0,
          min: 0,
        },

        walletFunding: {
          type: Number,
          default: 0,
          min: 0,
        },

        withdrawal: {
          type: Number,
          default: 0,
          min: 0,
        },

        merchantPayment: {
          type: Number,
          default: 0,
          min: 0,
        },

        airtime: {
          type: Number,
          default: 0,
          min: 0,
        },

        data: {
          type: Number,
          default: 0,
          min: 0,
        },
      },

      legalPolicies: {
        privacyPolicyUrl: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: "",
        },

        termsAndConditionsUrl: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: "",
        },

        amlPolicyUrl: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: "",
        },

        complaintsPolicyUrl: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: "",
        },

        dataProtectionPolicyUrl: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: "",
        },
      },
    },
  });
}

const defaultControl = () => ({
  maintenance: {
    enabled: false,
    customerAppEnabled: true,
    apiEnabled: true,
    message:
      "ServicePay is temporarily undergoing maintenance. Please try again shortly.",
    scheduledStartAt: null,
    scheduledEndAt: null,
  },

  transactionFees: {
    servicepayTransfer: 0,
    bankTransfer: 0,
    walletFunding: 0,
    withdrawal: 0,
    merchantPayment: 0,
    airtime: 0,
    data: 0,
  },

  legalPolicies: {
    privacyPolicyUrl: "",
    termsAndConditionsUrl: "",
    amlPolicyUrl: "",
    complaintsPolicyUrl: "",
    dataProtectionPolicyUrl: "",
  },
});

const getCurrent = (settings) => {
  const defaults = defaultControl();

  const raw =
    settings?.fintechControl?.toObject?.() ||
    settings?.fintechControl ||
    {};

  return {
    maintenance: {
      ...defaults.maintenance,
      ...(raw.maintenance || {}),
    },

    transactionFees: {
      ...defaults.transactionFees,
      ...(raw.transactionFees || {}),
    },

    legalPolicies: {
      ...defaults.legalPolicies,
      ...(raw.legalPolicies || {}),
    },
  };
};

const boolValue = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const v = String(value)
    .trim()
    .toLowerCase();

  if (["true", "1", "yes", "on"].includes(v)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(v)) {
    return false;
  }

  return fallback;
};

const moneyValue = (value, fallback) => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }

  return Number(n.toFixed(2));
};

const stringValue = (value, fallback = "") => {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value).trim();
};

const dateValue = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  if (value === null || value === "") {
    return null;
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return fallback;
  }

  return d;
};

const loadSettings = async () => {
  return AppSettings.findOne();
};

exports.getFintechControlSettings =
async (req, res) => {
  try {
    const settings =
      await loadSettings();

    if (!settings) {
      return res.status(404).json({
        success: false,
        message:
          "AppSettings document not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: getCurrent(settings),
    });
  } catch (error) {
    console.error(
      "Fintech Control GET error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load Fintech Control settings.",
    });
  }
};

exports.updateFintechControlSettings =
async (req, res) => {
  try {
    const settings =
      await loadSettings();

    if (!settings) {
      return res.status(404).json({
        success: false,
        message:
          "AppSettings document not found.",
      });
    }

    const current =
      getCurrent(settings);

    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const maintenance =
      body.maintenance &&
      typeof body.maintenance === "object"
        ? body.maintenance
        : {};

    const fees =
      body.transactionFees &&
      typeof body.transactionFees === "object"
        ? body.transactionFees
        : {};

    const legal =
      body.legalPolicies &&
      typeof body.legalPolicies === "object"
        ? body.legalPolicies
        : {};

    settings.set(
      "fintechControl.maintenance.enabled",
      boolValue(
        maintenance.enabled,
        current.maintenance.enabled
      )
    );

    settings.set(
      "fintechControl.maintenance.customerAppEnabled",
      boolValue(
        maintenance.customerAppEnabled,
        current.maintenance.customerAppEnabled
      )
    );

    settings.set(
      "fintechControl.maintenance.apiEnabled",
      boolValue(
        maintenance.apiEnabled,
        current.maintenance.apiEnabled
      )
    );

    settings.set(
      "fintechControl.maintenance.message",
      stringValue(
        maintenance.message,
        current.maintenance.message
      ).slice(0, 500)
    );

    settings.set(
      "fintechControl.maintenance.scheduledStartAt",
      dateValue(
        maintenance.scheduledStartAt,
        current.maintenance.scheduledStartAt
      )
    );

    settings.set(
      "fintechControl.maintenance.scheduledEndAt",
      dateValue(
        maintenance.scheduledEndAt,
        current.maintenance.scheduledEndAt
      )
    );

    const feeKeys = [
      "servicepayTransfer",
      "bankTransfer",
      "walletFunding",
      "withdrawal",
      "merchantPayment",
      "airtime",
      "data",
    ];

    for (const key of feeKeys) {
      settings.set(
        `fintechControl.transactionFees.${key}`,
        moneyValue(
          fees[key],
          current.transactionFees[key]
        )
      );
    }

    const legalKeys = [
      "privacyPolicyUrl",
      "termsAndConditionsUrl",
      "amlPolicyUrl",
      "complaintsPolicyUrl",
      "dataProtectionPolicyUrl",
    ];

    for (const key of legalKeys) {
      settings.set(
        `fintechControl.legalPolicies.${key}`,
        stringValue(
          legal[key],
          current.legalPolicies[key]
        ).slice(0, 1000)
      );
    }

    await settings.save();

    return res.status(200).json({
      success: true,
      message:
        "Fintech Control settings updated successfully.",
      data: getCurrent(settings),
    });

  } catch (error) {
    console.error(
      "Fintech Control PUT error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update Fintech Control settings.",
    });
  }
};
