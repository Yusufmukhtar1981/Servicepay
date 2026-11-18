"use strict";
const { createCustomerExperience } = require("../services/customerExperience.service");
const service = createCustomerExperience();
const handle = (action) => async (req, res) => {
  if (req.user?.role !== "CUSTOMER") {
    return res.status(403).json({ success: false, message: "Customer account required." });
  }
  try {
    return res.json({ success: true, ...await action(req) });
  } catch (error) {
    return res.status(error.status || 503).json({
      success: false,
      code: error.code === "CREDIT_ALERT_DEDUPLICATION_UNAVAILABLE"
        ? error.code : undefined,
      message: error.status ? error.message : "Customer settings or credit alerts are temporarily unavailable.",
    });
  }
};
exports.getSettings = handle(async (req) => ({
  settings: await service.getSettings(req.user._id),
}));
exports.updateSettings = handle(async (req) => ({
  settings: await service.updateSettings(req.user._id, req.body),
}));
exports.nextAlert = handle(async (req) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).length) {
    throw Object.assign(new Error("No customer, balance or transaction values may be supplied."), { status: 400 });
  }
  return service.nextAlert(req.user._id);
});
