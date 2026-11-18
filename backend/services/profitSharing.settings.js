"use strict";
const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const M = require("../models/businessNetwork.models");
const P = require("./profitSharing.policy");

const SERVICES = Object.freeze([
  "AIRTIME", "DATA", "ELECTRICITY", "CABLE", "EXAM_PIN",
  "NIN_VERIFICATION", "BVN_VERIFICATION", "DELIVERY", "SERVICEPAY_TRANSFER",
]);
const SETTINGS_ID = "profit-sharing";
const READINESS_MESSAGE = "Configuration only. Automatic profit-sharing settlement is not active. Existing commissions and customer wallets are unchanged.";
const fail = (statusCode, code, message) => {
  throw Object.assign(new Error(message), { statusCode, code });
};
const sha = value => createHash("sha256").update(value).digest("hex");
const publicItem = (serviceType, item) => ({
  serviceType, revision: item?.revision || 0,
  versions: [...(item?.versions || [])].reverse().map(({ requestHash, ...version }) => version),
});
const mayManage = req => Array.isArray(req.staffRole?.permissions) &&
  req.staffRole.permissions.includes("commissions.manage");

function createSettingsService({
  settingsModel = M.Settings, auditModel = M.Audit,
  startSession = () => mongoose.startSession(),
  now = () => new Date(),
} = {}) {
  const namespacesReady = async () => {
    for (const model of [settingsModel, auditModel]) {
      if (!await model.db.db.listCollections(
        { name: model.collection.name }, { nameOnly: true },
      ).hasNext()) {
        fail(503, "COMMISSION_SETTINGS_STORAGE_NOT_READY",
          "Existing Business Network settings and audit storage must be verified before saving.");
      }
    }
  };
  async function read() {
    const doc = await settingsModel.findById(SETTINGS_ID).lean();
    const engine = await require("./profitSharing.engine").createEngine().status();
    return {
      distributionLive: engine.distributionLive,
      readinessMessage: engine.distributionLive
        ? "Backend profit-sharing settlement is active for explicitly activated services only. Existing historical commissions and customer wallets are unchanged."
        : READINESS_MESSAGE,
      services: [...SERVICES], roles: [...P.ROLES],
      items: SERVICES.map(service => publicItem(service, doc?.profitSharing?.services?.[service])),
    };
  }
  async function save(actor, body) {
    if (!actor?._id) fail(403, "ADMIN_REQUIRED", "An authorized administrator is required.");
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(400, "INVALID_SETTINGS", "Invalid commission settings.");
    }
    const allowed = ["serviceType", "revision", "idempotencyKey", "confirmation",
      "reason", "effectiveAt", "enabled", "percentages"];
    if (Object.keys(body).some(key => !allowed.includes(key))) {
      fail(400, "UNSUPPORTED_SETTINGS_FIELD", "Only commission rule settings can be changed here.");
    }
    if (!SERVICES.includes(body.serviceType)) fail(400, "INVALID_SERVICE", "Choose a supported service.");
    if (body.confirmation !== true) fail(400, "CONFIRMATION_REQUIRED", "Confirm the future commission rule before saving.");
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
      fail(400, "INVALID_REVISION", "Reload the saved rule before making changes.");
    }
    if (typeof body.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.idempotencyKey)) {
      fail(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid request key is required.");
    }
    if (typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 500) {
      fail(400, "REASON_REQUIRED", "Enter an audit reason between 10 and 500 characters.");
    }
    const eventId = sha(`${actor._id}:${body.idempotencyKey}`);
    // Stable canonical serialization makes benign property ordering irrelevant.
    let percentages;
    try {
      const bps = P.percentageBasisPoints(body.percentages);
      percentages = Object.fromEntries(P.ROLES.map(role => [role, bps[role] / 100]));
    } catch (error) {
      fail(400, error.code, "Enter five valid percentages, with at most two decimal places, totaling exactly 100%.");
    }
    if (typeof body.effectiveAt !== "string" || !Number.isFinite(Date.parse(body.effectiveAt))) {
      fail(400, "INVALID_EFFECTIVE_DATE", "Choose a valid future effective date and time.");
    }
    if (typeof body.enabled !== "boolean") fail(400, "INVALID_RULE_ENABLED", "Choose whether this future rule is enabled or paused.");
    const rule = {
      id: eventId, serviceType: body.serviceType, enabled: body.enabled,
      effectiveAt: new Date(body.effectiveAt).toISOString(), percentages,
    };
    const reason = body.reason.trim();
    const requestHash = sha(JSON.stringify({ rule, reason, revision: body.revision }));
    await namespacesReady();
    const session = await startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const existing = await settingsModel.findById(SETTINGS_ID).session(session).lean();
        const services = existing?.profitSharing?.services || {};
        const prior = Object.values(services).flatMap(item => item.versions || [])
          .find(version => version.id === eventId);
        if (prior) {
          if (prior.requestHash !== requestHash) {
            fail(409, "IDEMPOTENCY_CONFLICT", "This request key belongs to a different change. Refresh and review the saved rule.");
          }
          // A replay is valid after the effective time too; no duplicate audit
          // entry, revision increment or historical rule modification.
          result = { ...publicItem(body.serviceType, services[body.serviceType]), replayed: true };
          return;
        }
        const current = services[body.serviceType] || { revision: 0, versions: [] };
        if (current.revision !== body.revision) {
          fail(409, "COMMISSION_RULE_CHANGED", "Another administrator changed this service. Refresh and review before saving.");
        }
        if (current.versions.length >= 500) {
          fail(409, "COMMISSION_RULE_HISTORY_LIMIT", "Preserved rule history requires an approved archive strategy before adding more versions.");
        }
        const at = now();
        try { P.validateRule(rule, at); }
        catch (error) { fail(400, error.code, "The effective date must not precede the current time."); }
        const version = { ...rule, requestHash, reason, createdAt: at.toISOString(), createdBy: String(actor._id) };
        const next = { revision: current.revision + 1, versions: [...current.versions, version] };
        if (existing) {
          const changed = await settingsModel.updateOne(
            { _id: SETTINGS_ID, revision: existing.revision },
            { $set: { [`profitSharing.services.${body.serviceType}`]: next }, $inc: { revision: 1 } },
            { session, runValidators: true },
          );
          if (changed.modifiedCount !== 1) fail(409, "COMMISSION_RULE_CHANGED", "Settings changed. Refresh and review before saving.");
        } else {
          await settingsModel.create([{
            _id: SETTINGS_ID, revision: 1,
            profitSharing: { services: { [body.serviceType]: next } },
          }], { session });
        }
        await auditModel.create([{
          actor: actor._id, action: "PROFIT_SHARING_RULE_SAVED", reason,
          metadata: {
            serviceType: body.serviceType, revision: next.revision,
            previousRuleId: current.versions.at(-1)?.id || null,
            rule: { ...rule }, eventId, distributionLive: false,
          },
        }], { session });
        result = { ...publicItem(body.serviceType, next), replayed: false };
      });
      return result;
    } catch (error) {
      if (error.code === 11000) {
        fail(409, "COMMISSION_RULE_CHANGED", "Settings changed while saving. Refresh and retry only the same request if its outcome is uncertain.");
      }
      throw error;
    } finally { await session.endSession(); }
  }
  return { read, save };
}
module.exports = { createSettingsService, mayManage, SERVICES, READINESS_MESSAGE };
