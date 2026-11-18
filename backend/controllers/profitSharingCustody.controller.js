"use strict";
const custody = require("../services/profitSharing.custody");
const { reauthenticate } = require("../services/accountRecovery.service");
const route = approve => async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const allowed = ["currentPassword", "adminNote", "payoutReference", "manualPaymentConfirmed",
      "expectedAmount", "expectedAccountNumber", "providerStatus", "payoutStatus"];
    if (!req.body || Object.keys(req.body).some(key => !allowed.includes(key))) {
      return res.status(400).json({ success: false, code: "INVALID_COMMISSION_PAYOUT_FIELDS",
        message: "Only confirmation of this saved commission withdrawal is accepted." });
    }
    await reauthenticate(req.user, req.body.currentPassword);
    const { currentPassword, ...body } = req.body;
    const result = await custody.finalize(req.user, req.params.id, body, approve);
    res.json({ success: true, message: approve
      ? "Manual bank payout recorded against commission custody."
      : "Commission reservation released without changing the main wallet.", ...result });
  } catch (error) {
    const status = error.statusCode || error.status || 503;
    res.status(status).json({
      success: false, code: typeof error.code === "string" ? error.code : "COMMISSION_WITHDRAWAL_UNAVAILABLE",
      message: status < 500 ? error.message : "Commission withdrawal could not be finalized. Refresh before retrying.",
    });
  }
};
exports.approve = route(true);
exports.reject = route(false);
