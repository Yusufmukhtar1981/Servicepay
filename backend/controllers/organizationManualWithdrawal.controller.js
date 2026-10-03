"use strict";
const service = require("../services/organizationManualWithdrawal.service");
const base = require("../services/organizations.service");
const { hasPermission } = require("../middleware/staffPermission.middleware");
const admin = (req, permission) => {
  if (base.isHierarchyManager(req.user) || !(base.platform(req) || hasPermission(req.staffAccess, permission))) {
    throw Object.assign(new Error("Authorized ServicePay Admin access is required."), { status: 403 });
  }
};
const handle = (action) => async (req, res) => {
  res.set?.("X-ServicePay-Organization-Withdrawals", "manual-v1");
  try { await action(req, res); }
  catch (e) {
    const status = e.status || e.statusCode || 500;
    return res.status(status).json({ success: false, message: status >= 500 ? "Withdrawal service is temporarily unavailable. Please retry using the same request." : e.message });
  }
};
exports.bank = handle(async (req, res) => {
  const account = await service.bank(req); res.json({ success: true, account, data: { account } });
});
exports.saveBank = handle(async (req, res) => {
  const account = await service.saveBank(req); res.json({ success: true, account, data: { account } });
});
exports.wallet = handle(async (req, res) => res.json({ success: true, data: await service.wallet(req) }));
exports.list = handle(async (req, res) => { const data = await service.list(req); res.json({ success: true, data, ...data }); });
exports.create = handle(async (req, res) => {
  const result = await service.create(req);
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: result.withdrawal, ...result });
});
exports.adminList = handle(async (req, res) => {
  admin(req, "organizations.withdrawals.view");
  const data = await service.list(req, true); res.json({ success: true, data, ...data });
});
exports.paid = handle(async (req, res) => {
  admin(req, "organizations.withdrawals.review");
  const withdrawal = await service.transition(req, "COMPLETED"); res.json({ success: true, withdrawal, data: withdrawal });
});
exports.reject = handle(async (req, res) => {
  admin(req, "organizations.withdrawals.review");
  const withdrawal = await service.transition(req, "REJECTED"); res.json({ success: true, withdrawal, data: withdrawal });
});