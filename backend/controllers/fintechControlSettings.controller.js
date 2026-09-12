const mongoose = require("mongoose");
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
const TOGGLE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

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

const plainMap = (value) => {
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return object(value);
};

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
  const services = settings?.services?.toObject?.() || settings?.services || {};
  return {
    maintenance: { ...defaults.maintenance, ...object(raw.maintenance) },
    serviceLimits: { ...defaults.serviceLimits, ...object(raw.serviceLimits) },
    transactionFees: { ...defaults.transactionFees, ...object(raw.transactionFees) },
    legalPolicies: { ...defaults.legalPolicies, ...object(raw.legalPolicies) },
    featureToggles: {
      ...plainMap(raw.featureToggles),
      ...services,
    },
    featureRegistry: plainMap(raw.featureRegistry),
  };
}

function actor(req) {
  return req.user?._id || req.user?.id || req.userId || null;
}

function hasDurableActor(req) {
  const actorId = actor(req);
  return Boolean(actorId && mongoose.Types.ObjectId.isValid(actorId));
}

async function writeAudit(req, previousData, newData, reason, session) {
  const actorId = actor(req);
  if (!hasDurableActor(req)) {
    throw new Error("A durable actor identity is required for fintech-control audit records.");
  }
  await AdminAuditLog.create([{
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
  }], { session });
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
  let session;
  try {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 10) {
      return res.status(400).json({
        success: false,
        message: "A specific audit reason of at least 10 characters is required.",
      });
    }
    if (!hasDurableActor(req)) {
      return res.status(401).json({
        success: false,
        code: "DURABLE_ACTOR_REQUIRED",
        message: "A durable authenticated actor is required for fintech-control changes.",
      });
    }
    session = await mongoose.startSession();
    await session.startTransaction();
    const settings = await AppSettings.getGlobalSettings({ session });
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
      if (!TOGGLE_KEY.test(key)) {
        return res.status(400).json({
          success: false,
          message: `featureToggles.${key} is not a valid toggle key.`,
        });
      }
      const enabled = boolean(value, undefined);
      if (enabled === null || enabled === undefined) {
        return res.status(400).json({ success: false, message: `featureToggles.${key} must be true or false.` });
      }
      next.featureToggles[key] = enabled;
    }

    const opaqueToggles = Object.fromEntries(
      Object.entries(next.featureToggles).filter(
        ([key]) => !settings.schema.path(`services.${key}`)
      )
    );
    settings.set("fintechControl", {
      maintenance: next.maintenance,
      serviceLimits: next.serviceLimits,
      transactionFees: next.transactionFees,
      legalPolicies: next.legalPolicies,
      featureToggles: opaqueToggles,
      featureRegistry: next.featureRegistry,
    });
    settings.set("platform.maintenanceMode", next.maintenance.enabled);
    settings.set("platform.maintenanceMessage", next.maintenance.message);
    for (const [key, value] of Object.entries(next.featureToggles)) {
      if (settings.schema.path(`services.${key}`)) settings.set(`services.${key}`, value);
    }
    settings.updatedBy = actor(req) || settings.updatedBy;
    settings.lastUpdatedBy = actor(req) || settings.lastUpdatedBy;
    settings.lastUpdatedByName = req.user?.fullName || req.user?.name || "";
    settings.lastUpdateReason = reason.slice(0, 500);
    await settings.save({ session });
    const saved = current(settings);
    await writeAudit(req, previous, saved, settings.lastUpdateReason, session);
    await session.commitTransaction();
    return res.json({ success: true, message: "Fintech Control settings saved.", data: saved });
  } catch (error) {
    console.error("Fintech Control PUT error:", error);
    return res.status(500).json({ success: false, message: "Unable to save Fintech Control settings." });
  } finally {
    if (session) {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  }
};