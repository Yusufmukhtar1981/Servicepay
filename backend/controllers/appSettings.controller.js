const AppSettings = require(
  "../models/appSettings.model"
);

const AdminAuditLog = require(
  "../models/adminAuditLog.model"
);

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

const normalizeRole = (value = "") => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const getActorId = (req) => {
  return (
    req.user?._id ||
    req.user?.id ||
    req.userId ||
    null
  );
};

const getClientIp = (req) => {
  const forwardedFor = String(
    req.headers["x-forwarded-for"] || ""
  ).trim();

  if (forwardedFor) {
    return forwardedFor
      .split(",")[0]
      .trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  );
};

const toBoolean = (
  value,
  fallback
) => {
  if (value === true || value === false) {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
};

const toAmount = (
  value,
  fallback
) => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return Number(parsed.toFixed(2));
};

const cleanString = (
  value,
  fallback = ""
) => {
  if (value === undefined) {
    return fallback;
  }

  return String(value || "").trim();
};

const cleanEmail = (
  value,
  fallback = ""
) => {
  return cleanString(
    value,
    fallback
  ).toLowerCase();
};

const validateEmail = (email) => {
  if (!email) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
};

const cloneSettings = (settings) => {
  if (!settings) {
    return null;
  }

  if (
    typeof settings.toObject ===
    "function"
  ) {
    return settings.toObject();
  }

  return JSON.parse(
    JSON.stringify(settings)
  );
};

const requireHeadOffice = (
  req,
  res
) => {
  const role = normalizeRole(
    req.user?.role
  );

  if (role !== "HEAD_OFFICE") {
    res.status(403).json({
      success: false,
      message:
        "Only Head Office can update ServicePay settings.",
    });

    return false;
  }

  return true;
};

const createSettingsAuditLog = async ({
  req,
  reason,
  previousData,
  newData,
}) => {
  try {
    const actorId =
      getActorId(req);

    if (!actorId) {
      return null;
    }

    return await AdminAuditLog.create({
      actorId,

      actorRole:
        normalizeRole(
          req.user?.role
        ) || "UNKNOWN",

      actorName:
        req.user?.fullName ||
        req.user?.name ||
        "",

      targetUserId: null,
      targetUserName:
        "GLOBAL SETTINGS",

      action:
        "SYSTEM_SETTING_UPDATED",

      reason,

      previousData,
      newData,

      metadata: {
        settingsKey:
          "GLOBAL_SETTINGS",
      },

      ipAddress:
        getClientIp(req),

      userAgent: String(
        req.headers["user-agent"] ||
          ""
      ).trim(),

      requestMethod:
        req.method,

      requestPath:
        req.originalUrl,

      status:
        "SUCCESSFUL",
    });
  } catch (error) {
    /*
     * Settings must remain saved even if
     * audit-log creation has a problem.
     */
    console.error(
      "Settings audit-log error:",
      error
    );

    return null;
  }
};

const getOrCreateSettings =
  async () => {
    return AppSettings
      .getGlobalSettings();
  };

/*
|--------------------------------------------------------------------------
| PUBLIC SETTINGS
|--------------------------------------------------------------------------
|
| This endpoint contains only settings that are safe
| for the customer app and website.
|
*/

exports.getPublicSettings = async (
  req,
  res
) => {
  try {
    const settings =
      await getOrCreateSettings();

    return res.status(200).json({
      success: true,
      message:
        "Public settings loaded successfully.",

      settings: {
        applicationName:
          settings.applicationName,

        applicationSlogan:
          settings.applicationSlogan,

        currency:
          settings.currency,

        currencySymbol:
          settings.currencySymbol,

        services:
          settings.services,

        electricity:
          settings.electricity,

        platform:
          settings.platform,

        kyc: {
          requiredForRegistration:
            settings.kyc
              ?.requiredForRegistration ===
            true,

          requiredAfterRegistration:
            settings.kyc
              ?.requiredAfterRegistration !==
            false,

          requiredForWalletFunding:
            settings.kyc
              ?.requiredForWalletFunding !==
            false,

          requiredForServicepayTransfer:
            settings.kyc
              ?.requiredForServicepayTransfer !==
            false,

          requiredForBankTransfer:
            settings.kyc
              ?.requiredForBankTransfer !==
            false,

          acceptedIdentityType:
            settings.kyc
              ?.acceptedIdentityType ||
            "NIN_OR_BVN",

          unverifiedCustomerCanUseBasicServices:
            settings.kyc
              ?.unverifiedCustomerCanUseBasicServices !==
            false,

          unverifiedCustomerDailyLimit:
            Number(
              settings.kyc
                ?.unverifiedCustomerDailyLimit ||
                0
            ),

          minimumAge:
            Number(
              settings.kyc
                ?.minimumAge ||
                18
            ),
        },

        registration:
          settings.registration,

        transactionLimits:
          settings.transactionLimits,

        support:
          settings.support,

        appVersion:
          settings.appVersion,
      },

      data: {
        settings: {
          applicationName:
            settings.applicationName,

          applicationSlogan:
            settings.applicationSlogan,

          currency:
            settings.currency,

          currencySymbol:
            settings.currencySymbol,

          services:
            settings.services,

          electricity:
            settings.electricity,

          platform:
            settings.platform,

          kyc:
            settings.kyc,

          registration:
            settings.registration,

          transactionLimits:
            settings.transactionLimits,

          support:
            settings.support,

          appVersion:
            settings.appVersion,
        },
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
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET ADMIN SETTINGS
|--------------------------------------------------------------------------
*/

exports.getAdminSettings = async (
  req,
  res
) => {
  try {
    const settings =
      await getOrCreateSettings();

    return res.status(200).json({
      success: true,
      message:
        "Admin settings loaded successfully.",

      settings,

      data: {
        settings,
      },
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
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE ADMIN SETTINGS
|--------------------------------------------------------------------------
*/

exports.updateAdminSettings = async (
  req,
  res
) => {
  try {
    if (
      !requireHeadOffice(
        req,
        res
      )
    ) {
      return;
    }

    const body =
      req.body || {};

    const reason = String(
      body.reason ||
        body.adminReason ||
        ""
    ).trim();

    if (reason.length < 5) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a clear administrative reason containing at least 5 characters.",
      });
    }

    if (reason.length > 500) {
      return res.status(400).json({
        success: false,
        message:
          "Administrative reason cannot exceed 500 characters.",
      });
    }

    const settings =
      await getOrCreateSettings();

    const previousData =
      cloneSettings(settings);

    const services =
      body.services || {};

    const electricity =
      body.electricity || {};

    const platform =
      body.platform || {};

    const kyc =
      body.kyc || {};

    const registration =
      body.registration || {};

    const limits =
      body.transactionLimits || {};

    const support =
      body.support || {};

    const appVersion =
      body.appVersion || {};

    /*
    |--------------------------------------------------------------------------
    | GENERAL APPLICATION INFORMATION
    |--------------------------------------------------------------------------
    */

    settings.applicationName =
      cleanString(
        body.applicationName,
        settings.applicationName
      ) || "ServicePay";

    settings.applicationSlogan =
      cleanString(
        body.applicationSlogan,
        settings.applicationSlogan
      );

    settings.currency =
      cleanString(
        body.currency,
        settings.currency
      )
        .toUpperCase() ||
      "NGN";

    settings.currencySymbol =
      cleanString(
        body.currencySymbol,
        settings.currencySymbol
      ) || "₦";

    /*
    |--------------------------------------------------------------------------
    | SERVICE AVAILABILITY
    |--------------------------------------------------------------------------
    */

    settings.services.kekeNapep =
      toBoolean(
        services.kekeNapep,
        settings.services.kekeNapep
      );

    settings.services.amana =
      toBoolean(
        services.amana,
        settings.services.amana
      );

    settings.services.airtime =
      toBoolean(
        services.airtime,
        settings.services.airtime
      );

    settings.services.data =
      toBoolean(
        services.data,
        settings.services.data
      );

    settings.services.electricity =
      toBoolean(
        services.electricity,
        settings.services.electricity
      );

    settings.services.cableTv =
      toBoolean(
        services.cableTv,
        settings.services.cableTv
      );

    settings.services.examPin =
      toBoolean(
        services.examPin,
        settings.services.examPin
      );

    settings.services.ninVerification =
      toBoolean(
        services.ninVerification,
        settings.services
          .ninVerification
      );

    settings.services.bvnVerification =
      toBoolean(
        services.bvnVerification,
        settings.services
          .bvnVerification
      );

    settings.services.delivery =
      toBoolean(
        services.delivery,
        settings.services.delivery
      );

    settings.services.walletFunding =
      toBoolean(
        services.walletFunding,
        settings.services
          .walletFunding
      );

    settings.services
      .servicepayTransfer =
      toBoolean(
        services.servicepayTransfer,
        settings.services
          .servicepayTransfer
      );

    settings.services.bankTransfer =
      toBoolean(
        services.bankTransfer,
        settings.services.bankTransfer
      );

    settings.services.flightBooking =
      toBoolean(
        services.flightBooking,
        settings.services.flightBooking
      );

    settings.services.notifications =
      toBoolean(
        services.notifications,
        settings.services.notifications
      );

    /*
     * Keep old public-settings fields synchronized.
     */
    settings.services.airtimeEnabled =
      settings.services.airtime;

    settings.services.dataEnabled =
      settings.services.data;

    settings.services
      .electricityEnabled =
      settings.services.electricity;

    settings.services
      .ninVerificationEnabled =
      settings.services.ninVerification;

    /*
    |--------------------------------------------------------------------------
    | ELECTRICITY SETTINGS
    |--------------------------------------------------------------------------
    */

    const minimumElectricityAmount =
      toAmount(
        electricity.minimumAmount,
        Number(
          settings.electricity
            .minimumAmount ||
            0
        )
      );

    const maximumElectricityAmount =
      toAmount(
        electricity.maximumAmount,
        Number(
          settings.electricity
            .maximumAmount ||
            0
        )
      );

    if (
      minimumElectricityAmount ===
      null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid minimum electricity amount.",
      });
    }

    if (
      maximumElectricityAmount ===
        null ||
      maximumElectricityAmount <=
        minimumElectricityAmount
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum electricity amount must be greater than the minimum amount.",
      });
    }

    settings.electricity.minimumAmount =
      minimumElectricityAmount;

    settings.electricity.maximumAmount =
      maximumElectricityAmount;

    /*
    |--------------------------------------------------------------------------
    | PLATFORM / MAINTENANCE
    |--------------------------------------------------------------------------
    */

    settings.platform.maintenanceMode =
      toBoolean(
        platform.maintenanceMode,
        settings.platform
          .maintenanceMode
      );

    settings.platform.maintenanceTitle =
      cleanString(
        platform.maintenanceTitle,
        settings.platform
          .maintenanceTitle
      ) ||
      "ServicePay Maintenance";

    settings.platform
      .maintenanceMessage =
      cleanString(
        platform.maintenanceMessage,
        settings.platform
          .maintenanceMessage
      );

    /*
    |--------------------------------------------------------------------------
    | KYC SETTINGS
    |--------------------------------------------------------------------------
    */

    settings.kyc.requiredForRegistration =
      toBoolean(
        kyc.requiredForRegistration,
        settings.kyc
          .requiredForRegistration
      );

    settings.kyc.requiredAfterRegistration =
      toBoolean(
        kyc.requiredAfterRegistration,
        settings.kyc
          .requiredAfterRegistration
      );

    settings.kyc
      .requiredForWalletFunding =
      toBoolean(
        kyc.requiredForWalletFunding,
        settings.kyc
          .requiredForWalletFunding
      );

    settings.kyc
      .requiredForServicepayTransfer =
      toBoolean(
        kyc.requiredForServicepayTransfer,
        settings.kyc
          .requiredForServicepayTransfer
      );

    settings.kyc
      .requiredForBankTransfer =
      toBoolean(
        kyc.requiredForBankTransfer,
        settings.kyc
          .requiredForBankTransfer
      );

    settings.kyc
      .requiredForHighValueTransactions =
      toBoolean(
        kyc.requiredForHighValueTransactions,
        settings.kyc
          .requiredForHighValueTransactions
      );

    const acceptedIdentityType =
      cleanString(
        kyc.acceptedIdentityType,
        settings.kyc
          .acceptedIdentityType
      ).toUpperCase();

    const allowedIdentityTypes = [
      "NIN",
      "BVN",
      "NIN_OR_BVN",
      "NIN_AND_BVN",
    ];

    if (
      !allowedIdentityTypes.includes(
        acceptedIdentityType
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid accepted KYC identity type.",
        allowedIdentityTypes,
      });
    }

    settings.kyc.acceptedIdentityType =
      acceptedIdentityType;

    settings.kyc
      .unverifiedCustomerCanUseBasicServices =
      toBoolean(
        kyc.unverifiedCustomerCanUseBasicServices,
        settings.kyc
          .unverifiedCustomerCanUseBasicServices
      );

    const unverifiedDailyLimit =
      toAmount(
        kyc.unverifiedCustomerDailyLimit,
        Number(
          settings.kyc
            .unverifiedCustomerDailyLimit ||
            0
        )
      );

    const highValueThreshold =
      toAmount(
        kyc.highValueTransactionThreshold,
        Number(
          settings.kyc
            .highValueTransactionThreshold ||
            0
        )
      );

    const minimumAge = Number(
      kyc.minimumAge ??
        settings.kyc.minimumAge ??
        18
    );

    if (
      unverifiedDailyLimit === null ||
      highValueThreshold === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter valid KYC transaction limits.",
      });
    }

    if (
      !Number.isInteger(minimumAge) ||
      minimumAge < 0 ||
      minimumAge > 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum age must be between 0 and 100.",
      });
    }

    settings.kyc
      .unverifiedCustomerDailyLimit =
      unverifiedDailyLimit;

    settings.kyc
      .highValueTransactionThreshold =
      highValueThreshold;

    settings.kyc.minimumAge =
      minimumAge;

    /*
    |--------------------------------------------------------------------------
    | REGISTRATION SETTINGS
    |--------------------------------------------------------------------------
    */

    settings.registration
      .registrationEnabled =
      toBoolean(
        registration.registrationEnabled,
        settings.registration
          .registrationEnabled
      );

    settings.registration.requireEmail =
      toBoolean(
        registration.requireEmail,
        settings.registration.requireEmail
      );

    settings.registration
      .requirePhoneVerification =
      toBoolean(
        registration.requirePhoneVerification,
        settings.registration
          .requirePhoneVerification
      );

    settings.registration
      .requireEmailVerification =
      toBoolean(
        registration.requireEmailVerification,
        settings.registration
          .requireEmailVerification
      );

    settings.registration
      .requireNinOrBvnAfterRegistration =
      toBoolean(
        registration
          .requireNinOrBvnAfterRegistration,
        settings.registration
          .requireNinOrBvnAfterRegistration
      );

    settings.registration
      .allowReferralCode =
      toBoolean(
        registration.allowReferralCode,
        settings.registration
          .allowReferralCode
      );

    const defaultCustomerStatus =
      cleanString(
        registration.defaultCustomerStatus,
        settings.registration
          .defaultCustomerStatus
      ).toUpperCase();

    const allowedCustomerStatuses = [
      "ACTIVE",
      "SUSPENDED",
      "BLOCKED",
    ];

    if (
      !allowedCustomerStatuses.includes(
        defaultCustomerStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid default customer status.",
        allowedCustomerStatuses,
      });
    }

    settings.registration
      .defaultCustomerStatus =
      defaultCustomerStatus;

    /*
    |--------------------------------------------------------------------------
    | TRANSACTION LIMITS
    |--------------------------------------------------------------------------
    */

    const limitFields = [
      "minimumWalletFunding",
      "maximumWalletFunding",
      "minimumServicepayTransfer",
      "maximumServicepayTransfer",
      "dailyServicepayTransferLimit",
      "minimumBankTransfer",
      "maximumBankTransfer",
      "dailyBankTransferLimit",
      "minimumAirtimePurchase",
      "maximumAirtimePurchase",
      "maximumDataPurchase",
      "maximumElectricityPayment",
      "maximumCableTvPayment",
      "dailyCustomerTransactionLimit",
    ];

    for (
      const field of limitFields
    ) {
      const amount = toAmount(
        limits[field],
        Number(
          settings.transactionLimits[
            field
          ] || 0
        )
      );

      if (amount === null) {
        return res.status(400).json({
          success: false,
          message:
            `Enter a valid value for ${field}.`,
        });
      }

      settings.transactionLimits[
        field
      ] = amount;
    }

    if (
      settings.transactionLimits
        .maximumWalletFunding <
      settings.transactionLimits
        .minimumWalletFunding
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum wallet funding must not be less than the minimum.",
      });
    }

    if (
      settings.transactionLimits
        .maximumServicepayTransfer <
      settings.transactionLimits
        .minimumServicepayTransfer
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum ServicePay transfer must not be less than the minimum.",
      });
    }

    if (
      settings.transactionLimits
        .maximumBankTransfer <
      settings.transactionLimits
        .minimumBankTransfer
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum bank transfer must not be less than the minimum.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | SUPPORT SETTINGS
    |--------------------------------------------------------------------------
    */

    const supportPhone =
      cleanString(
        support.supportPhone ??
          support.phone,
        settings.support
          .supportPhone ||
          settings.support.phone
      );

    const supportEmail =
      cleanEmail(
        support.supportEmail ??
          support.email,
        settings.support
          .supportEmail ||
          settings.support.email
      );

    if (!supportPhone) {
      return res.status(400).json({
        success: false,
        message:
          "Support phone number is required.",
      });
    }

    if (
      !validateEmail(
        supportEmail
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid support email address.",
      });
    }

    settings.support.supportPhone =
      supportPhone;

    settings.support.phone =
      supportPhone;

    settings.support.supportEmail =
      supportEmail;

    settings.support.email =
      supportEmail;

    settings.support.whatsappNumber =
      cleanString(
        support.whatsappNumber,
        settings.support
          .whatsappNumber
      );

    settings.support.aiSupportEnabled =
      toBoolean(
        support.aiSupportEnabled,
        settings.support.aiSupportEnabled !== false
      );

    settings.support.humanEscalationEnabled =
      toBoolean(
        support.humanEscalationEnabled,
        settings.support.humanEscalationEnabled !== false
      );

    settings.support.officeAddress =
      cleanString(
        support.officeAddress,
        settings.support
          .officeAddress
      );

    settings.support.websiteUrl =
      cleanString(
        support.websiteUrl,
        settings.support.websiteUrl
      );

    settings.support.privacyPolicyUrl =
      cleanString(
        support.privacyPolicyUrl,
        settings.support
          .privacyPolicyUrl
      );

    settings.support
      .termsAndConditionsUrl =
      cleanString(
        support.termsAndConditionsUrl,
        settings.support
          .termsAndConditionsUrl
      );

    settings.support
      .supportAvailableFrom =
      cleanString(
        support.supportAvailableFrom,
        settings.support
          .supportAvailableFrom
      ) || "08:00";

    settings.support.supportAvailableTo =
      cleanString(
        support.supportAvailableTo,
        settings.support
          .supportAvailableTo
      ) || "18:00";

    if (
      Array.isArray(
        support.supportDays
      )
    ) {
      settings.support.supportDays =
        support.supportDays
          .map(
            (day) =>
              String(day)
                .trim()
                .toUpperCase()
          )
          .filter(Boolean);
    }

    /*
    |--------------------------------------------------------------------------
    | APP VERSION SETTINGS
    |--------------------------------------------------------------------------
    */

    settings.appVersion
      .minimumSupportedVersion =
      cleanString(
        appVersion.minimumSupportedVersion,
        settings.appVersion
          .minimumSupportedVersion
      ) || "1.0.0";

    settings.appVersion.latestVersion =
      cleanString(
        appVersion.latestVersion,
        settings.appVersion.latestVersion
      ) || "1.0.0";

    settings.appVersion.forceUpdate =
      toBoolean(
        appVersion.forceUpdate,
        settings.appVersion.forceUpdate
      );

    settings.appVersion.updateMessage =
      cleanString(
        appVersion.updateMessage,
        settings.appVersion.updateMessage
      );

    settings.appVersion.androidUpdateUrl =
      cleanString(
        appVersion.androidUpdateUrl,
        settings.appVersion
          .androidUpdateUrl
      );

    settings.appVersion.iosUpdateUrl =
      cleanString(
        appVersion.iosUpdateUrl,
        settings.appVersion
          .iosUpdateUrl
      );

    /*
    |--------------------------------------------------------------------------
    | UPDATE INFORMATION
    |--------------------------------------------------------------------------
    */

    settings.updatedBy =
      getActorId(req);

    settings.lastUpdatedBy =
      getActorId(req);

    settings.lastUpdatedByName =
      req.user?.fullName ||
      req.user?.name ||
      "";

    settings.lastUpdateReason =
      reason;

    await settings.save();

    const newData =
      cloneSettings(settings);

    await createSettingsAuditLog({
      req,
      reason,
      previousData,
      newData,
    });

    return res.status(200).json({
      success: true,
      message:
        "Admin settings saved successfully.",

      settings,

      data: {
        settings,
      },
    });
  } catch (error) {
    console.error(
      "Update admin settings error:",
      error
    );

    if (
      error?.name ===
      "ValidationError"
    ) {
      const message =
        Object.values(
          error.errors || {}
        )
          .map(
            (item) =>
              item.message
          )
          .join(", ");

      return res.status(400).json({
        success: false,
        message:
          message ||
          "Invalid settings information.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to save admin settings.",
      error: error.message,
    });
  }
};