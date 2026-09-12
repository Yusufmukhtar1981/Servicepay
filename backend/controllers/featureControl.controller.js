const mongoose = require("mongoose");
const AppSettings = require("../models/appSettings.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { STAFF_PERMISSIONS: P } = require("../middleware/staffPermission.middleware");

/*
 * This is the single registry for customer-facing controls.  Keys that map to
 * an existing services field continue to use that field as their source of
 * truth; the registry adds the controls that the older settings document did
 * not have without creating a second settings system.
 */
const FEATURE_REGISTRY = Object.freeze([
  ["airtime", "Airtime", "Payments", "Mobile airtime purchases.", "airtime"],
  ["data", "Mobile Data", "Payments", "Mobile data purchases.", "data"],
  ["electricity", "Electricity", "Payments", "Electricity bill payments.", "electricity"],
  ["cableTv", "Cable TV", "Payments", "Cable television subscriptions.", "cableTv"],
  ["examPin", "Exam PIN", "Payments", "Education examination PINs.", "examPin"],
  ["ninVerification", "NIN Verification", "Payments", "NIN identity verification.", "ninVerification"],
  ["bvnVerification", "BVN Verification", "Payments", "BVN identity verification.", "bvnVerification"],
  ["wallet", "Wallet", "Money", "Customer wallet and ledger access.", null],
  ["walletFunding", "Wallet Funding", "Money", "Funding a customer wallet.", "walletFunding"],
  ["servicepayTransfer", "ServicePay Transfer", "Money", "Transfers between ServicePay wallets.", "servicepayTransfer"],
  ["bankTransfer", "Bank Transfer", "Money", "Transfers to supported bank accounts.", "bankTransfer"],
  ["withdrawal", "Withdrawal", "Money", "Customer wallet withdrawals.", null],
  ["qrPay", "QR Pay", "Money", "QR-based payments.", null],
  ["payByLink", "Pay-by-Link", "Money", "Payment links.", null],
  ["requestMoney", "Request Money", "Money", "Customer payment requests.", null],
  ["marketplace", "Marketplace", "Business & Community", "Marketplace browsing and orders.", null],
  ["storePosting", "Store/Marketplace Posting", "Business & Community", "Merchant marketplace posting.", null],
  ["organizations", "Organizations", "Business & Community", "Organization workspace access.", null],
  ["organizationWithdrawals", "Organization Withdrawals", "Business & Community", "Organization treasury withdrawals.", null],
  ["empowerment", "Empowerment", "Business & Community", "Empowerment programmes.", null],
  ["programSponsor", "Program Sponsor", "Business & Community", "Programme sponsorship.", null],
  ["groupWallet", "Group Wallet / Ajo", "Business & Community", "Group wallet services.", null],
  ["delivery", "Delivery", "Lifestyle & Services", "Delivery booking and tracking.", "delivery"],
  ["transport", "Transport", "Lifestyle & Services", "Transport and ride services.", null],
  ["kekeNapep", "Keke NAPEP", "Lifestyle & Services", "Keke NAPEP rides.", "kekeNapep"],
  ["solar", "ServicePay Solar", "Lifestyle & Services", "Solar packages and applications.", null],
  ["phoneFinancing", "Phone Financing", "Lifestyle & Services", "Phone financing applications.", null],
  ["amana", "ServicePay Amana", "Lifestyle & Services", "Amana orders and fulfilment.", "amana"],
  ["servicepayCall", "ServicePay Call", "Lifestyle & Services", "ServicePay voice calls.", null],
  ["aiSupport", "AI Support", "Lifestyle & Services", "AI customer support.", null],
  ["miniApps", "Mini Apps", "Lifestyle & Services", "ServicePay mini applications.", null],
  ["cards", "Cards", "Lifestyle & Services", "ServicePay cards.", null],
  ["flightBooking", "Flight Booking", "Lifestyle & Services", "Flight booking when available.", "flightBooking"],
  ["referral", "Referral", "Growth", "Customer referral programme.", null],
  ["notifications", "Notifications", "Platform", "Customer notifications.", "notifications"],
]);

const PROTECTED_FEATURES = new Set([
  "wallet", "walletFunding", "servicepayTransfer", "bankTransfer",
  "withdrawal", "organizationWithdrawals",
]);
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const plain = (value) => {
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return object(value);
};

const actor = (req) => req.user?._id || req.user?.id || req.userId || null;
const hasDurableActor = (req) => {
  const actorId = actor(req);
  return Boolean(actorId && mongoose.Types.ObjectId.isValid(actorId));
};
const role = (req) => String(req.user?.role || "").trim().toUpperCase();
const isServicePaySuperAdmin = (req) =>
  role(req) === "SERVICEPAY_SUPER_ADMIN";
const canProtectedManage = (req) =>
  isServicePaySuperAdmin(req) ||
  (Array.isArray(req.staffAccess?.permissions) &&
    req.staffAccess.permissions.includes(P.FEATURE_CONTROL_PROTECTED_MANAGE));

const reasonFrom = (body) =>
  String(body?.reason || body?.adminReason || "").trim();

const normalizeDate = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const currentFeature = (settings, definition, now = new Date()) => {
  const [key, displayName, category, description, legacyKey] = definition;
  const registry = plain(settings?.fintechControl?.featureRegistry);
  const persisted = registry[key] || registry[String(key).toUpperCase()] || {};
  const services = plain(settings?.services);
  const toggles = plain(settings?.fintechControl?.featureToggles);
  const enabled = persisted.enabled !== undefined
    ? Boolean(persisted.enabled)
    : (legacyKey && services[legacyKey] !== undefined
      ? Boolean(services[legacyKey])
      : (legacyKey && services[`${legacyKey}Enabled`] !== undefined
        ? Boolean(services[`${legacyKey}Enabled`])
      : (legacyKey && toggles[legacyKey] !== undefined
        ? Boolean(toggles[legacyKey])
        : true)));
  const scheduledEnabledAt = persisted.scheduledEnabledAt || null;
  const scheduledDisabledAt = persisted.scheduledDisabledAt || null;
  let effectiveEnabled = enabled;
  const scheduleEvents = [
    scheduledEnabledAt && { at: new Date(scheduledEnabledAt), enabled: true },
    scheduledDisabledAt && { at: new Date(scheduledDisabledAt), enabled: false },
  ].filter((event) => event && !Number.isNaN(event.at.getTime()))
    .sort((a, b) => a.at - b.at);
  for (const event of scheduleEvents) {
    if (event.at <= now) effectiveEnabled = event.enabled;
  }
  return {
    key,
    displayName,
    category,
    description,
    enabled,
    effectiveEnabled,
    visible: persisted.visible !== false,
    maintenanceMode: persisted.maintenanceMode === true,
    maintenanceTitle: String(persisted.maintenanceTitle || ""),
    maintenanceMessage: String(
      persisted.maintenanceMessage ||
        `This ${displayName} service is temporarily unavailable.`
    ),
    scope: persisted.scope || "GLOBAL",
    scheduledEnabledAt,
    scheduledDisabledAt,
    expectedReturnAt: persisted.expectedReturnAt || null,
    minimumAppVersion: persisted.minimumAppVersion || null,
    updatedAt: persisted.updatedAt || settings?.updatedAt || null,
    updatedBy: persisted.updatedBy || settings?.lastUpdatedByName || null,
    protected: PROTECTED_FEATURES.has(key),
  };
};

const currentRegistry = (settings) =>
  FEATURE_REGISTRY.map((definition) => currentFeature(settings, definition));

const definitionFor = (key) =>
  FEATURE_REGISTRY.find(
    (definition) =>
      definition[0] === key ||
      definition[0].toUpperCase() === String(key || "").toUpperCase()
  );

const persistFeature = (settings, feature) => {
  const current = plain(settings.fintechControl.featureRegistry);
  current[feature.key] = {
    enabled: feature.enabled,
    visible: feature.visible,
    maintenanceMode: feature.maintenanceMode,
    maintenanceTitle: feature.maintenanceTitle,
    maintenanceMessage: feature.maintenanceMessage,
    expectedReturnAt: feature.expectedReturnAt,
    scope: feature.scope,
    scheduledEnabledAt: feature.scheduledEnabledAt,
    scheduledDisabledAt: feature.scheduledDisabledAt,
    minimumAppVersion: feature.minimumAppVersion,
    updatedAt: feature.updatedAt,
    updatedBy: feature.updatedBy,
  };
  settings.set("fintechControl.featureRegistry", current);
  const definition = definitionFor(feature.key);
  const legacyKey = definition && definition[4];
  if (legacyKey && settings.schema.path(`services.${legacyKey}`)) {
    settings.set(`services.${legacyKey}`, feature.enabled);
    settings.set(`fintechControl.featureToggles.${legacyKey}`, feature.enabled);
  }
};

const validateReason = (req, res) => {
  const reason = reasonFrom(req.body);
  if (reason.length < 10) {
    res.status(400).json({
      success: false,
      message: "A specific audit reason of at least 10 characters is required.",
    });
    return null;
  }
  if (reason.length > 500) {
    res.status(400).json({ success: false, message: "Audit reason cannot exceed 500 characters." });
    return null;
  }
  return reason;
};

const requireProtectedConfirmation = (req, res, keys) => {
  const protectedKeys = keys.filter((key) => PROTECTED_FEATURES.has(key));
  if (!protectedKeys.length) return true;
  if (!canProtectedManage(req)) {
    res.status(403).json({
      success: false,
      code: "PROTECTED_FEATURE_PERMISSION_REQUIRED",
      requiredPermission: P.FEATURE_CONTROL_PROTECTED_MANAGE,
      message: "Protected financial feature control permission is required.",
    });
    return false;
  }
  const confirmation = String(
    req.body?.confirmationText || req.body?.protectedConfirmation || ""
  ).trim();
  if (confirmation !== protectedKeys.join(",")) {
    res.status(409).json({
      success: false,
      code: "PROTECTED_CONFIRMATION_REQUIRED",
      message: `Type ${protectedKeys.join(",")} to confirm this protected change.`,
    });
    return false;
  }
  return true;
};

const writeAudit = async (req, reason, previousData, newData, featureKey, session) => {
  const actorId = actor(req);
  if (!hasDurableActor(req)) {
    throw new Error("A durable actor identity is required for feature-control audit records.");
  }
  await AdminAuditLog.create([{
    actorId,
    actorRole: role(req) || "UNKNOWN",
    actorName: req.user?.fullName || req.user?.name || "",
    targetUserName: "FEATURE CONTROL",
    action: "FEATURE_CONTROL_UPDATED",
    reason,
    previousData,
    newData,
    metadata: { settingsKey: "FEATURE_CONTROL", featureKey },
    ipAddress: String(req.headers?.["x-forwarded-for"] || req.ip || ""),
    userAgent: String(req.headers?.["user-agent"] || ""),
    requestMethod: req.method,
    requestPath: req.originalUrl,
    status: "SUCCESSFUL",
  }], { session });
};

const metrics = (features) => ({
  total: features.length,
  enabled: features.filter((feature) => feature.effectiveEnabled).length,
  disabled: features.filter((feature) => !feature.effectiveEnabled).length,
  hidden: features.filter((feature) => !feature.visible).length,
  maintenance: features.filter((feature) => feature.maintenanceMode).length,
});

exports.registry = async (req, res) => {
  try {
    const settings = await AppSettings.getGlobalSettings();
    const features = currentRegistry(settings);
    return res.json({
      success: true,
      data: {
        features,
        metrics: metrics(features),
        sync: {
          healthy: true,
          source: "DATABASE_SETTINGS",
          lastSyncAt: settings.updatedAt || null,
          realtime: false,
        },
      },
      features,
      metrics: metrics(features),
    });
  } catch (error) {
    console.error("Feature registry GET error:", error);
    return res.status(500).json({ success: false, message: "Unable to load feature registry." });
  }
};

exports.customer = async (req, res) => {
  try {
    const settings = await AppSettings.getGlobalSettings();
    const features = currentRegistry(settings).map((feature) => ({
      key: feature.key,
      title: feature.displayName,
      displayName: feature.displayName,
      category: feature.category,
      description: feature.description,
      enabled: feature.effectiveEnabled,
      effectiveEnabled: feature.effectiveEnabled,
      visible: feature.visible,
      maintenanceMode: feature.maintenanceMode,
      message: feature.maintenanceMessage,
      maintenanceMessage: feature.maintenanceMessage,
      expectedReturnAt: feature.expectedReturnAt,
      schedule: {
        scheduledEnabledAt: feature.scheduledEnabledAt,
        scheduledDisabledAt: feature.scheduledDisabledAt,
      },
    }));
    return res.json({
      success: true,
      version: settings.updatedAt ? settings.updatedAt.toISOString() : null,
      data: { features },
      features,
    });
  } catch (error) {
    console.error("Customer feature configuration GET error:", error);
    const features = FEATURE_REGISTRY.map(([key, displayName, category, description]) => ({
      key, title: displayName, displayName, category, description,
      enabled: true, effectiveEnabled: true, visible: true, maintenanceMode: false,
    }));
    return res.json({ success: true, data: { features }, features, fallback: true });
  }
};

exports.patch = async (req, res) => {
  const requestedKey = String(req.params.key || "").trim();
  const definition = definitionFor(requestedKey);
  const key = definition ? definition[0] : requestedKey;
  if (!definition || !KEY_PATTERN.test(requestedKey)) {
    return res.status(404).json({ success: false, message: "Feature is not registered." });
  }
  const reason = validateReason(req, res);
  if (!reason || !requireProtectedConfirmation(req, res, [key])) return;
  if (!hasDurableActor(req)) {
    return res.status(401).json({
      success: false,
      code: "DURABLE_ACTOR_REQUIRED",
      message: "A durable authenticated actor is required for feature-control changes.",
    });
  }
  let session;
  try {
    session = await mongoose.startSession();
    await session.startTransaction();
    const settings = await AppSettings.getGlobalSettings({ session });
    const previous = currentFeature(settings, definition);
    const body = object(req.body?.feature || req.body);
    const next = { ...previous };
    for (const field of ["enabled", "visible", "maintenanceMode"]) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== "boolean") {
          return res.status(400).json({ success: false, message: `${field} must be true or false.` });
        }
        next[field] = body[field];
      }
    }
    for (const field of ["maintenanceTitle", "maintenanceMessage", "scope", "minimumAppVersion"]) {
      if (body[field] !== undefined) next[field] = body[field] === null ? null : String(body[field]).trim();
    }
    for (const field of ["scheduledEnabledAt", "scheduledDisabledAt"]) {
      if (body[field] !== undefined) {
        const value = normalizeDate(body[field]);
        if (value === undefined) return res.status(400).json({ success: false, message: `Invalid ${field} date.` });
        next[field] = value;
      }
    }
    if (body.expectedReturnAt !== undefined) {
      const value = normalizeDate(body.expectedReturnAt);
      if (value === undefined) return res.status(400).json({ success: false, message: "Invalid expectedReturnAt date." });
      next.expectedReturnAt = value;
    }
    if (next.maintenanceMode && !String(next.maintenanceMessage || "").trim()) {
      return res.status(400).json({ success: false, message: "A maintenance message is required when maintenance mode is enabled." });
    }
    next.updatedAt = new Date();
    next.updatedBy = req.user?.fullName || req.user?.name || role(req);
    persistFeature(settings, next);
    settings.lastUpdateReason = reason;
    settings.lastUpdatedBy = actor(req) || settings.lastUpdatedBy;
    settings.lastUpdatedByName = next.updatedBy;
    await settings.save({ session });
    const saved = currentFeature(settings, definition);
    await writeAudit(req, reason, previous, saved, key, session);
    await session.commitTransaction();
    return res.json({ success: true, message: "Feature control saved.", data: saved });
  } catch (error) {
    console.error("Feature control PATCH error:", error);
    return res.status(500).json({ success: false, message: "Unable to save feature control." });
  } finally {
    if (session) {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  }
};

exports.bulk = async (req, res) => {
  const keys = Array.isArray(req.body?.keys)
    ? [...new Set(req.body.keys
      .map((key) => definitionFor(String(key).trim())?.[0])
      .filter(Boolean))]
    : [];
  const action = String(req.body?.action || "").trim().toUpperCase();
  const actions = {
    ENABLE: { enabled: true },
    DISABLE: { enabled: false },
    SHOW: { visible: true },
    HIDE: { visible: false },
  };
  if (!keys.length || !actions[action] || keys.some((key) => !definitionFor(key))) {
    return res.status(400).json({ success: false, message: "Choose registered features and a valid bulk action." });
  }
  const reason = validateReason(req, res);
  if (!reason || !requireProtectedConfirmation(req, res, keys)) return;
  if (!hasDurableActor(req)) {
    return res.status(401).json({
      success: false,
      code: "DURABLE_ACTOR_REQUIRED",
      message: "A durable authenticated actor is required for feature-control changes.",
    });
  }
  let session;
  try {
    session = await mongoose.startSession();
    await session.startTransaction();
    const settings = await AppSettings.getGlobalSettings({ session });
    const all = currentRegistry(settings);
    const changed = [];
    for (const key of keys) {
      const previous = all.find((feature) => feature.key === key);
      const next = { ...previous, ...actions[action], updatedAt: new Date(), updatedBy: req.user?.fullName || req.user?.name || role(req) };
      persistFeature(settings, next);
      changed.push({ previous, next });
    }
    settings.lastUpdateReason = reason;
    settings.lastUpdatedBy = actor(req) || settings.lastUpdatedBy;
    await settings.save({ session });
    for (const item of changed) {
      await writeAudit(
        req,
        reason,
        item.previous,
        currentFeature(settings, definitionFor(item.next.key)),
        item.next.key,
        session
      );
    }
    await session.commitTransaction();
    return res.json({ success: true, message: "Feature controls saved.", data: { features: currentRegistry(settings), metrics: metrics(currentRegistry(settings)) } });
  } catch (error) {
    console.error("Feature control bulk error:", error);
    return res.status(500).json({ success: false, message: "Unable to save feature controls." });
  } finally {
    if (session) {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  }
};

exports.audit = async (req, res) => {
  try {
    const filter = { "metadata.settingsKey": "FEATURE_CONTROL" };
    if (req.query?.featureKey || req.params?.key) {
      filter["metadata.featureKey"] = String(req.query?.featureKey || req.params.key);
    }
    const rows = await AdminAuditLog.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ success: true, data: { entries: rows, audit: rows } });
  } catch (error) {
    console.error("Feature control audit GET error:", error);
    return res.status(500).json({ success: false, message: "Unable to load feature control audit history." });
  }
};

exports.FEATURE_REGISTRY = FEATURE_REGISTRY;
exports.PROTECTED_FEATURES = PROTECTED_FEATURES;
exports.currentFeature = currentFeature;
exports.currentRegistry = currentRegistry;
exports.metrics = metrics;
exports.canProtectedManage = canProtectedManage;
