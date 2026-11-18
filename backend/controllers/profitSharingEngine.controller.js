"use strict";
const { createEngine } = require("../services/profitSharing.engine");
const { reauthenticate } = require("../services/accountRecovery.service");
const engine = createEngine();
const route = fn => async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try { res.json({ success: true, data: await fn(req) }); }
  catch (error) {
    const status = error.statusCode || error.status || 503;
    res.status(status).json({ success: false,
      code: error.code || "PROFIT_SHARING_UNAVAILABLE",
      message: error.code || "Profit-sharing operation could not be completed. Refresh its status before retrying." });
  }
};
exports.status = route(() => engine.status());
exports.settlements = route(req => require("../services/profitSharing.reporting").headOffice(req.query));
exports.dryRun = route(req => {
  if (typeof req.body?.transactionId !== "string" || !/^[a-f\d]{24}$/i.test(req.body.transactionId) ||
      Object.keys(req.body).some(k => k !== "transactionId")) {
    throw Object.assign(new Error("Only a saved transaction identifier is accepted."),
      { statusCode: 400, code: "SAVED_TRANSACTION_ID_REQUIRED" });
  }
  return engine.dryRun(req.user, req.body.transactionId);
});
exports.activation = route(async req => {
  const allowed = ["mode", "revision", "services", "serviceAction", "confirmation", "confirmationText", "reason", "currentPassword", "dryRunIds"];
  if (!req.body || Object.keys(req.body).some(k => !allowed.includes(k))) {
    throw Object.assign(new Error("Invalid activation fields."), { statusCode: 400, code: "INVALID_ACTIVATION_FIELDS" });
  }
  // Existing durable per-admin rate limit, password comparison, active account
  // and token-version checks. Password is never persisted or included in audit.
  await reauthenticate(req.user, req.body.currentPassword);
  const { currentPassword, ...body } = req.body;
  return engine.changeMode(req.user, body);
});
