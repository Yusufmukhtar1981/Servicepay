const AppSettings = require("../models/appSettings.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const LIMIT_KEYS = [
  "tier1Daily", "tier1PerTransaction", "tier2Daily",
  "tier2PerTransaction", "tier3Daily", "tier3PerTransaction",
  "servicepayTransfer", "bankTransfer", "walletFunding", "withdrawal",
];
const FEE_KEYS = [
  "servicepayTransfer", "bankTransfer", "walletFunding", "withdrawal",
  "merchantPayment", "airtime", "data",
];
const LEGAL_KEYS = [
  "privacyPolicyUrl", "termsAndConditionsUrl", "amlPolicyUrl",
  "complaintsPolicyUrl", "dataProtectionPolicyUrl",
];

const defaultControl = () => ({
  maintenance: {
    enabled: false, customerAppEnabled: true, apiEnabled: true,
    message: "ServicePay is temporarily undergoing maintenance. Please try again shortly.",
    scheduledStartAt: null, scheduledEndAt: null,
  },
  serviceLimits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, 0])),
  transactionFees: Object.fromEntries(FEE_KEYS.map((key) => [key, 0])),
  legalPolicies: Object.fromEntries(LEGAL_KEYS.map((key) => [key, ""])),
  featureToggles: {},
});

const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const boolean = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
};

const number = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
};

const date = (value, fallback) => {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

function current(settings) {
  const defaults = defaultControl();
  const raw = settings?.fintechControl?.toObject?.() || settings?.fintechControl || {};
  return {
    maintenance: { ...defaults.maintenance, ...object(raw.maintenance) },
    serviceLimits: { ...defaults.serviceLimits, ...object(raw.serviceLimits) },
    transactionFees: { ...defaults.transactionFees, ...object(raw.transactionFees) },
    legalPolicies: { ...defaults.legalPolicies, ...object(raw.legalPolicies) },
    featureToggles: { ...(settings?.services?.toObject?.() || settings?.services || {}) },
  };
}

function actor(req) {
  return req.user?._id || req.user?.id || req.userId || null;
}

async function writeAudit(req, previousData, newData, reason) {
  const actorId = actor(req);
  if (!actorId) return;
  await AdminAuditLog.create({
    actorId,
    actorRole: String(req.user?.role || "HEAD_OFFICE").toUpperCase(),
    actorName: req.user?.fullName || req.user?.name || "",
    targetUserName: "FINTECH CONTROL",
    action: "SYSTEM_SETTING_UPDATED",
    reason: reason || "Fintech Control Center update",
    previousData,
    newData,
    metadata: { settingsKey: "FINTECH_CONTROL" },
    ipAddress: String(req.ip || ""),
    userAgent: String(req.headers["user-agent"] || ""),
    requestMethod: req.method,
    requestPath: req.originalUrl,
    status: "SUCCESSFUL",
  });
}

exports.getFintechControlSettings = async (req, res) => {
  try {
    const settings = await AppSettings.getGlobalSettings();
    return res.json({ success: true, data: current(settings) });
  } catch (error) {
    console.error("Fintech Control GET error:", error);
    return res.status(500).json({ success: false, message: "Unable to load Fintech Control settings." });
  }
};

exports.updateFintechControlSettings = async (req, res) => {
  try {
    const settings = await AppSettings.getGlobalSettings();
    const previous = current(settings);
    const body = object(req.body?.fintechControl || req.body);
    const maintenance = object(body.maintenance);
    const limits = object(body.serviceLimits);
    const fees = object(body.transactionFees);
    const legal = object(body.legalPolicies);
    const toggles = object(body.featureToggles);
    const next = JSON.parse(JSON.stringify(previous));

    for (const key of ["enabled", "customerAppEnabled", "apiEnabled"]) {
      const value = boolean(maintenance[key], next.maintenance[key]);
      if (value === null) return res.status(400).json({ success: false, message: `Invalid maintenance.${key} value.` });
      next.maintenance[key] = value;
    }
    if (maintenance.message !== undefined) next.maintenance.message = String(maintenance.message || "").trim().slice(0, 500);
    for (const key of ["scheduledStartAt", "scheduledEndAt"]) {
      const value = date(maintenance[key], next.maintenance[key]);
      if (value === undefined) return res.status(400).json({ success: false, message: `Invalid maintenance.${key} date.` });
      next.maintenance[key] = value;
    }
    for (const [group, input, keys] of [
      ["serviceLimits", limits, LIMIT_KEYS],
      ["transactionFees", fees, FEE_KEYS],
    ]) {
      for (const key of keys) {
        const value = number(input[key], next[group][key]);
        if (value === null) return res.status(400).json({ success: false, message: `${group}.${key} must be a non-negative number.` });
        next[group][key] = value;
      }
    }
    for (const key of LEGAL_KEYS) {
      if (legal[key] !== undefined) next.legalPolicies[key] = String(legal[key] || "").trim().slice(0, 1000);
    }
    for (const [key, value] of Object.entries(toggles)) {
      const enabled = boolean(value, undefined);
      if (enabled === null || enabled === undefined) {
        return res.status(400).json({ success: false, message: `featureToggles.${key} must be true or false.` });
      }
      next.featureToggles[key] = enabled;
    }

    settings.set("fintechControl", {
      maintenance: next.maintenance,
      serviceLimits: next.serviceLimits,
      transactionFees: next.transactionFees,
      legalPolicies: next.legalPolicies,
    });
    settings.set("platform.maintenanceMode", next.maintenance.enabled);
    settings.set("platform.maintenanceMessage", next.maintenance.message);
    for (const [key, value] of Object.entries(next.featureToggles)) {
      if (settings.schema.path(`services.${key}`)) settings.set(`services.${key}`, value);
    }
    settings.updatedBy = actor(req) || settings.updatedBy;
    settings.lastUpdatedBy = actor(req) || settings.lastUpdatedBy;
    settings.lastUpdatedByName = req.user?.fullName || req.user?.name || "";
    settings.lastUpdateReason = String(req.body?.reason || "Fintech Control Center update").trim().slice(0, 500);
    await settings.save();

    const saved = current(settings);
    await writeAudit(req, previous, saved, settings.lastUpdateReason);
    return res.json({ success: true, message: "Fintech Control settings saved.", data: saved });
  } catch (error) {
    console.error("Fintech Control PUT error:", error);
    return res.status(500).json({ success: false, message: "Unable to save Fintech Control settings." });
  }
};