"use strict";
const { createSettingsService, mayManage } = require("../services/profitSharing.settings");
const service = createSettingsService();
const respond = handler => async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try { res.json({ success: true, data: await handler(req) }); }
  catch (error) {
    res.status(error.statusCode || 503).json({
      success: false,
      code: error.statusCode ? error.code : "COMMISSION_SETTINGS_UNAVAILABLE",
      message: error.statusCode ? error.message :
        "Commission settings are temporarily unavailable. Refresh before retrying the same request.",
    });
  }
};
exports.read = respond(async req => ({ ...await service.read(), canManage: mayManage(req) }));
exports.save = respond(req => service.save(req.user, req.body));
