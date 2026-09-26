const mongoose = require("mongoose");
const AdminAuditLog = require("../models/adminAuditLog.model");
const {
  DEFAULTS,
  SERVICE_PROVIDERS,
  getOrCreateServiceConfigForMutation,
  isAvailable,
  readProviderManagementMatrix,
  serializeConfig,
} = require("../services/providerManagement.service");

const allowedBodyKeys = new Set(["service", "action", "provider", "enabled"]);
const fail = (res, status, code, message) => res.status(status).json({
  success: false, code, message,
});
const actorId = (req) => req.user?._id || req.user?.id;

exports.getProviderManagement = async (_req, res) => {
  try {
    const items = await readProviderManagementMatrix();
    return res.json({ success: true, data: { items } });
  } catch (error) {
    return fail(res, 500, "PROVIDER_MANAGEMENT_READ_FAILED", "Unable to read provider configuration.");
  }
};

exports.patchProviderManagement = async (req, res) => {
  const body = req.body || {};
  if (Object.keys(body).some((key) => !allowedBodyKeys.has(key))) {
    return fail(res, 400, "INVALID_PROVIDER_MANAGEMENT_FIELDS", "Request contains unsupported fields.");
  }
  const service = typeof body.service === "string" ? body.service.trim().toUpperCase() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim().toUpperCase() : "";
  if (!Object.hasOwn(DEFAULTS, service)) {
    return fail(res, 400, "INVALID_SERVICE", "Service must be AIRTIME, DATA, ELECTRICITY, or CABLE.");
  }
  if (!["enable", "disable", "setPrimary", "setFallback"].includes(action)) {
    return fail(res, 400, "INVALID_ACTION", "Action must be enable, disable, setPrimary, or setFallback.");
  }
  if (!SERVICE_PROVIDERS[service].includes(provider)) {
    return fail(res, 400, "UNSUPPORTED_PROVIDER", "Provider is not allowlisted for this service.");
  }
  if (action === "enable" && body.enabled !== undefined && body.enabled !== true) {
    return fail(res, 400, "INVALID_ENABLED_VALUE", "The enable action requires enabled=true.");
  }
  if (action === "disable" && body.enabled !== undefined && body.enabled !== false) {
    return fail(res, 400, "INVALID_ENABLED_VALUE", "The disable action requires enabled=false.");
  }

  // No database state, even with a configured API key, can unlock TA purchases.
  if (provider === "TELECOM_ABODE" && action !== "disable") {
    return fail(res, 409, "TELECOM_ABODE_PURCHASES_LOCKED",
      "Telecom Abode purchases cannot be enabled or selected until financial contracts and production safeguards are verified.");
  }
  if (action === "setFallback") {
    return fail(res, 409, "FALLBACK_ROUTING_UNSUPPORTED",
      "Fallback routing is not implemented; automatic provider fallback is disabled.");
  }
  if (service === "CABLE") {
    return fail(res, 409, "CABLE_PURCHASE_UNAVAILABLE",
      "Cable purchasing is unavailable: no cable purchase route or provider adapter is implemented.");
  }
  if (["AIRTIME", "DATA"].includes(service) &&
      !(provider === "TELECOM_ABODE" && action === "disable")) {
    return fail(res, 409, "ROUTING_CONTROL_UNAVAILABLE",
      `${service} purchases are currently hard-wired to ClubKonnect. Provider control changes are locked until the purchase route has an atomic management gate.`);
  }

  let updated;
  let previous;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await getOrCreateServiceConfigForMutation(service, session);
        previous = serializeConfig(current);
        const state = current.providerStates.find((item) => item.provider === provider);
        if (!state) throw Object.assign(new Error("Provider is not configured for this service."), { statusCode: 400 });

        if ((action === "enable" || action === "setPrimary") && !isAvailable(service, provider)) {
          throw Object.assign(new Error("Provider is unavailable and cannot be enabled or selected."), {
            statusCode: 409, code: "PROVIDER_UNAVAILABLE",
          });
        }
        if (action === "enable") state.enabled = true;
        else if (action === "disable") state.enabled = false;
        else if (action === "setPrimary") {
          if (!state.enabled) {
            throw Object.assign(new Error("Enable an available provider before setting it as primary."), {
              statusCode: 409, code: "PRIMARY_PROVIDER_NOT_ENABLED",
            });
          }
          current.primaryProvider = provider;
        }
        current.updatedBy = actorId(req);
        await current.save({ session });
        updated = serializeConfig(current);

        await AdminAuditLog.create([{
          actorId: actorId(req),
          actorRole: req.user.role,
          actorName: req.user.fullName || req.user.name || "",
          action: "FINTECH_OPERATION",
          reason: `Provider management ${action} for ${service}.`,
          previousData: previous,
          newData: updated,
          metadata: { operation: "PROVIDER_MANAGEMENT", service, provider, action },
          ipAddress: req.ip || "",
          userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || "",
          requestMethod: req.method,
          requestPath: req.originalUrl,
        }], { session });
      });
      return res.json({ success: true, data: updated });
    } catch (error) {
      // If simultaneous first mutations race on the unique service index,
      // the losing transaction retries against the now-persisted config.
      if (error.code === 11000 && attempt < 2) continue;
      if (error.statusCode) return fail(res, error.statusCode, error.code || "PROVIDER_MANAGEMENT_REJECTED", error.message);
      return fail(res, 500, "PROVIDER_MANAGEMENT_UPDATE_FAILED", "Unable to update provider configuration; no unaudited change was accepted.");
    } finally {
      await session.endSession();
    }
  }
  return fail(res, 500, "PROVIDER_MANAGEMENT_UPDATE_FAILED", "Unable to update provider configuration.");
};