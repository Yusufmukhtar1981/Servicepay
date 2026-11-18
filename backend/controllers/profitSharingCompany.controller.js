"use strict";
const { createCompany } = require("../services/profitSharing.company");
const { reauthenticate } = require("../services/accountRecovery.service");
const { mayManage } = require("../services/profitSharing.settings");
const service = createCompany();
const route = fn => async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try { res.json({ success: true, data: { ...await fn(req), canManage: mayManage(req) } }); }
  catch (error) {
    const code = error.code && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : "COMPANY_PROFIT_SHARING_UNAVAILABLE";
    res.status(error.statusCode || 409).json({ success: false, code, message: code });
  }
};
exports.read = route(() => service.read());
const write = method => route(async req => {
  await reauthenticate(req.user, req.body?.currentPassword);
  const { currentPassword, ...body } = req.body || {};
  return service[method](req.user, body);
});
exports.save = write("save");
exports.activate = write("activate");
