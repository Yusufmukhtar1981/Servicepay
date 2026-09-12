const AppSettings = require("../models/appSettings.model");
const {
  featureBindingsForRequest,
} = require("../config/featureRouteRegistry");

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
  const raw = String(req?.originalUrl || req?.url || "");
  const pathname = raw.split("?")[0].split("#")[0].toLowerCase();
  const segments = pathname.split("/").filter(Boolean);
  const hasSegment = (segment) => segments.includes(segment);
  const hasPrefix = (prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);

  // Query strings and fragments are deliberately discarded.  Segment and
  // boundary matching prevents /not-admin, /administer, and similar paths
  // from inheriting management/provider bypass behavior.
  if (["admin", "auth", "health", "webhook", "callback"].some(hasSegment)) {
    return true;
  }

  return [
    "/app-settings/public",
    "/settings/customer/features",
    "/settings/features",
    "/settings/feature-control/config",
    "/app-settings/admin/fintech-control",
    "/settings/admin/fintech-control",
    "/settings/admin/feature-control",
    "/feature-control/admin",
    "/feature-control/config",
    "/feature-control/public",
  ].some(hasPrefix);
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
  const settings = await AppSettings.getGlobalSettings();
  const source = settings?.toObject ? settings.toObject() : settings;

  return {
    ...(source?.fintechControl || {}),
    featureToggles: {
      ...(source?.services || {}),
      ...(source?.fintechControl?.featureToggles || {}),
    },
    featureRegistry: source?.fintechControl?.featureRegistry || {},
  };
}

function featureState(control, key, now = new Date()) {
  const registry = control?.featureRegistry || {};
  const saved = registry instanceof Map
    ? (registry.get(key) || registry.get(String(key).toUpperCase()))
    : (registry[key] || registry[String(key).toUpperCase()]);
  const state = saved && typeof saved === "object" ? saved : {};
  let enabled = state.enabled !== false;
  const events = [
    state.scheduledEnabledAt && { at: new Date(state.scheduledEnabledAt), enabled: true },
    state.scheduledDisabledAt && { at: new Date(state.scheduledDisabledAt), enabled: false },
  ].filter((event) => event && !Number.isNaN(event.at.getTime()))
    .sort((a, b) => a.at - b.at);
  for (const event of events) {
    if (event.at <= now) enabled = event.enabled;
  }
  return {
    enabled,
    registryEnabled: state.enabled !== undefined,
    visible: state.visible !== false,
    maintenanceMode: state.maintenanceMode === true,
    maintenanceTitle: String(state.maintenanceTitle || ""),
    expectedReturnAt: state.expectedReturnAt || null,
    maintenanceMessage: String(
      state.maintenanceMessage || "This ServicePay feature is temporarily unavailable."
    ),
  };
}

function disabledService(req, control) {
  const toggles = control?.featureToggles || {};
  for (const key of featureBindingsForRequest(req)) {
    const state = featureState(control, key);
    if ((!state.registryEnabled && boolValue(toggles[key], true) === false) || !state.visible ||
        !state.enabled || state.maintenanceMode) {
      return {
        key,
        maintenance: state.maintenanceMode,
        maintenanceTitle: state.maintenanceTitle,
        expectedReturnAt: state.expectedReturnAt,
        message: state.maintenanceMessage,
      };
    }
  }
  return null;
}

// Route modules that need a more explicit guard can compose this middleware,
// while the global fintech middleware below protects existing production
// routes.  It deliberately returns the same public error contract.
function requireFeatureEnabled(key) {
  return async (req, res, next) => {
    let control = req.fintechControl;
    try {
      // The app-level middleware normally populates this once.  Loading here
      // as a fallback keeps the helper safe and reusable in isolated routers
      // and tests without introducing a second settings implementation.
      if (!control) {
        control = await loadFintechControl();
        req.fintechControl = control;
      }
    } catch (error) {
      console.error("Feature control enforcement error:", error.message);
      return next();
    }
    const state = featureState(control || {}, key);
    if (!state.visible || !state.enabled || state.maintenanceMode) {
      return res.status(503).json({
        success: false,
        code: state.maintenanceMode ? "FEATURE_MAINTENANCE" : "FEATURE_DISABLED",
        feature: key,
        title: state.maintenanceTitle || undefined,
        message: state.maintenanceMessage,
        expectedReturnAt: state.expectedReturnAt || null,
      });
    }
    return next();
  };
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
      "SERVICEPAY_SUPER_ADMIN",
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
          code: service.maintenance ? "FEATURE_MAINTENANCE" : "FEATURE_DISABLED",
          service: service.key,
          title: service.maintenanceTitle || undefined,
          message: service.message,
          expectedReturnAt: service.expectedReturnAt || null,
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
module.exports.isBypassPath = isBypassPath;
module.exports.featureState = featureState;
module.exports.requireFeatureEnabled = requireFeatureEnabled;
