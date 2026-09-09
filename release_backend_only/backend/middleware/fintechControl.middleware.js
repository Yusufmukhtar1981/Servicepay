const AppSettings = require("../models/appSettings.model");

/*
 * ServicePay Fintech Control Enforcement
 *
 * This middleware makes the settings saved from:
 * Admin > Platform Configuration
 * actually affect live backend requests.
 *
 * IMPORTANT:
 * - Admin routes are never blocked.
 * - Authentication/public/webhook routes are not blocked.
 * - Settings failure never crashes ServicePay.
 */

function boolValue(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;

  const text = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on", "enabled"].includes(text)) return true;
  if (["false", "0", "no", "off", "disabled"].includes(text)) return false;

  return fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeTier(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, "");

  if (
    text === "3" ||
    text === "TIER3" ||
    text === "LEVEL3"
  ) {
    return 3;
  }

  if (
    text === "2" ||
    text === "TIER2" ||
    text === "LEVEL2"
  ) {
    return 2;
  }

  return 1;
}

function requestAmount(req) {
  const candidates = [
    req.body?.amount,
    req.body?.totalAmount,
    req.body?.transactionAmount,
    req.body?.transferAmount,
    req.body?.value,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);

    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

function isMutation(req) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(
    String(req.method || "").toUpperCase()
  );
}

function isBypassPath(req) {
  const path = String(req.originalUrl || req.url || "").toLowerCase();

  const bypass = [
    "/admin",
    "/auth",
    "/health",
    "/webhook",
    "/callback",
    "/app-settings/public",
    "/app-settings/admin/fintech-control",
    "/settings/admin/fintech-control",
  ];

  return bypass.some((item) => path.includes(item));
}

function getTierLimits(control, tier) {
  const limits =
    control?.serviceLimits ||
    control?.limits ||
    {};

  const source = {
    ...control,
    ...limits,
  };

  if (tier === 3) {
    return {
      daily: numberValue(
        source.tier3Daily ??
        source.tier3DailyLimit
      ),
      perTransaction: numberValue(
        source.tier3PerTransaction ??
        source.tier3PerTransactionLimit
      ),
    };
  }

  if (tier === 2) {
    return {
      daily: numberValue(
        source.tier2Daily ??
        source.tier2DailyLimit
      ),
      perTransaction: numberValue(
        source.tier2PerTransaction ??
        source.tier2PerTransactionLimit
      ),
    };
  }

  return {
    daily: numberValue(
      source.tier1Daily ??
      source.tier1DailyLimit
    ),
    perTransaction: numberValue(
      source.tier1PerTransaction ??
      source.tier1PerTransactionLimit
    ),
  };
}

function getFeeMap(control) {
  const fees =
    control?.transactionFees ||
    control?.fees ||
    {};

  return {
    servicepayTransfer: numberValue(
      fees.servicepayTransfer ??
      control?.servicepayTransfer
    ),
    bankTransfer: numberValue(
      fees.bankTransfer ??
      control?.bankTransfer
    ),
    walletFunding: numberValue(
      fees.walletFunding ??
      control?.walletFunding
    ),
    withdrawal: numberValue(
      fees.withdrawal ??
      control?.withdrawal
    ),
    merchantPayment: numberValue(
      fees.merchantPayment ??
      control?.merchantPayment
    ),
    airtime: numberValue(
      fees.airtime ??
      control?.airtime
    ),
    data: numberValue(
      fees.data ??
      control?.data
    ),
  };
}

async function loadFintechControl() {
  const settings = await AppSettings
    .findOne({})
    .sort({ updatedAt: -1 })
    .lean();

  return {
    ...(settings?.fintechControl || {}),
    featureToggles: settings?.services || {},
  };
}

function disabledService(req, control) {
  const path = String(req.originalUrl || req.url || "").toLowerCase();
  const toggles = control?.featureToggles || {};
  const map = [
    ["/airtime", "airtime"],
    ["/data", "data"],
    ["/electricity", "electricity"],
    ["/cable", "cableTv"],
    ["/exam", "examPin"],
    ["/transfer/bank", "bankTransfer"],
    ["/transfer/servicepay", "servicepayTransfer"],
    ["/wallet/fund", "walletFunding"],
    ["/delivery", "delivery"],
    ["/amana", "amana"],
    ["/notifications", "notifications"],
  ];
  for (const [fragment, key] of map) {
    if (path.includes(fragment) && boolValue(toggles[key], true) === false) {
      return key;
    }
  }
  return null;
}

async function fintechControlMiddleware(req, res, next) {
  try {
    if (isBypassPath(req)) {
      return next();
    }

    const control = await loadFintechControl();

    /*
     * Make current controls available to every controller.
     */
    req.fintechControl = control;
    req.fintechFees = getFeeMap(control);

    /*
     * Maintenance configuration
     */
    const maintenance =
      control?.maintenance ||
      {};

    const globalMaintenance = boolValue(
      maintenance.enabled ??
      control?.maintenanceEnabled,
      false
    );

    const customerAppEnabled = boolValue(
      maintenance.customerAppEnabled ??
      control?.customerAppEnabled,
      true
    );

    const apiEnabled = boolValue(
      maintenance.apiEnabled ??
      control?.apiEnabled,
      true
    );

    const maintenanceMessage =
      String(
        maintenance.message ||
        control?.maintenanceMessage ||
        "ServicePay is temporarily undergoing maintenance. Please try again shortly."
      ).trim();

    /*
     * Admin/staff requests remain available so management
     * can restore the platform.
     */
    const role = String(
      req.user?.role ||
      req.staff?.role ||
      ""
    ).toUpperCase();

    const managementRoles = [
      "HEAD_OFFICE",
      "ADMIN",
      "SUPER_ADMIN",
      "STAFF",
    ];

    const managementUser =
      managementRoles.includes(role);

    if (!managementUser) {
      if (globalMaintenance) {
        return res.status(503).json({
          success: false,
          maintenance: true,
          message: maintenanceMessage,
        });
      }

      if (!customerAppEnabled) {
        return res.status(503).json({
          success: false,
          code: "CUSTOMER_APP_DISABLED",
          message:
            maintenanceMessage ||
            "ServicePay customer services are temporarily unavailable.",
        });
      }

      if (!apiEnabled && isMutation(req)) {
        return res.status(503).json({
          success: false,
          code: "API_DISABLED",
          message:
            maintenanceMessage ||
            "ServicePay transactions are temporarily unavailable.",
        });
      }

      const service = disabledService(req, control);
      if (service) {
        return res.status(503).json({
          success: false,
          code: "FEATURE_DISABLED",
          service,
          message: "This ServicePay feature is temporarily unavailable.",
        });
      }
    }

    /*
     * Tier per-transaction enforcement.
     *
     * Zero means "not configured", therefore existing
     * ServicePay behaviour remains unchanged.
     */
    if (
      !managementUser &&
      isMutation(req)
    ) {
      const amount = requestAmount(req);

      if (amount > 0) {
        const tier = normalizeTier(
          req.user?.kycTier ??
          req.user?.tier ??
          req.user?.kycLevel
        );

        const limits = getTierLimits(
          control,
          tier
        );

        if (
          limits.perTransaction > 0 &&
          amount > limits.perTransaction
        ) {
          return res.status(400).json({
            success: false,
            code: "TIER_TRANSACTION_LIMIT_EXCEEDED",
            tier,
            amount,
            limit: limits.perTransaction,
            message:
              `Tier ${tier} per transaction limit is ₦${limits.perTransaction.toLocaleString()}.`,
          });
        }

        req.fintechTier = tier;
        req.fintechTierLimits = limits;
      }
    }

    return next();
  } catch (error) {
    /*
     * Fail-open protection:
     * An unexpected settings error must never bring down
     * existing live ServicePay services.
     */
    console.error(
      "FINTECH CONTROL ENFORCEMENT ERROR:",
      error.message
    );

    return next();
  }
}

module.exports = fintechControlMiddleware;
module.exports.loadFintechControl = loadFintechControl;
module.exports.getFeeMap = getFeeMap;
