const AppSettings = require(
  "../models/appSettings.model"
);

const DEFAULT_SETTINGS = {
  key: "GLOBAL_SETTINGS",

  services: {
    airtimeEnabled: true,
    dataEnabled: true,
    electricityEnabled: true,
    ninVerificationEnabled: true,
  },

  electricity: {
    minimumAmount: 1000,
    maximumAmount: 200000,
  },

  platform: {
    maintenanceMode: false,
  },

  support: {
    phone: "08000000000",
    email: "support@servicepay.ng",
  },
};

const getOrCreateSettings = async () => {
  let settings = await AppSettings.findOne({
    key: "GLOBAL_SETTINGS",
  });

  if (!settings) {
    settings = await AppSettings.create(
      DEFAULT_SETTINGS
    );
  }

  return settings;
};

exports.getPublicSettings = async (
  req,
  res
) => {
  try {
    const settings =
      await getOrCreateSettings();

    return res.status(200).json({
      success: true,
      settings: {
        services: settings.services,
        electricity:
          settings.electricity,
        platform: settings.platform,
        support: settings.support,
      },
    });
  } catch (error) {
    console.error(
      "Get public settings error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load platform settings.",
    });
  }
};

exports.getAdminSettings = async (
  req,
  res
) => {
  try {
    const settings =
      await getOrCreateSettings();

    return res.status(200).json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error(
      "Get admin settings error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load admin settings.",
    });
  }
};

exports.updateAdminSettings = async (
  req,
  res
) => {
  try {
    const {
      services = {},
      electricity = {},
      platform = {},
      support = {},
    } = req.body || {};

    const minimumAmount = Number(
      electricity.minimumAmount
    );

    const maximumAmount = Number(
      electricity.maximumAmount
    );

    if (
      Number.isNaN(minimumAmount) ||
      minimumAmount < 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid minimum electricity amount.",
      });
    }

    if (
      Number.isNaN(maximumAmount) ||
      maximumAmount <= minimumAmount
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum electricity amount must be greater than the minimum amount.",
      });
    }

    const supportPhone = String(
      support.phone || ""
    ).trim();

    const supportEmail = String(
      support.email || ""
    )
      .trim()
      .toLowerCase();

    if (!supportPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Support phone number is required.",
      });
    }

    if (
      !supportEmail ||
      !supportEmail.includes("@")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid support email.",
      });
    }

    const updatedSettings =
      await AppSettings.findOneAndUpdate(
        {
          key: "GLOBAL_SETTINGS",
        },
        {
          $set: {
            "services.airtimeEnabled":
              services.airtimeEnabled !==
              false,

            "services.dataEnabled":
              services.dataEnabled !==
              false,

            "services.electricityEnabled":
              services.electricityEnabled !==
              false,

            "services.ninVerificationEnabled":
              services.ninVerificationEnabled !==
              false,

            "electricity.minimumAmount":
              minimumAmount,

            "electricity.maximumAmount":
              maximumAmount,

            "platform.maintenanceMode":
              platform.maintenanceMode ===
              true,

            "support.phone":
              supportPhone,

            "support.email":
              supportEmail,

            updatedBy:
              req.user?._id || null,
          },
          $setOnInsert: {
            key: "GLOBAL_SETTINGS",
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      success: true,
      message:
        "Admin settings saved successfully.",
      settings: updatedSettings,
    });
  } catch (error) {
    console.error(
      "Update admin settings error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to save admin settings.",
    });
  }
};
