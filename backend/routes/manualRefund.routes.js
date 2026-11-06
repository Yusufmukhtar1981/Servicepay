const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission, requireExplicitPermission } = require("../middleware/staffPermission.middleware");
const service = require("../services/manualRefund.service");
const { refund } = service.createRefundService();
const headOffice = (req, res, next) =>
  req.user?.role === "HEAD_OFFICE" && req.staffAccess?.isHeadOffice === true &&
    req.staffAccess?.scope?.type === "GLOBAL" ? next() :
    res.status(403).json({ success: false, code: "HEAD_OFFICE_REQUIRED", message: "Authorized Head Office access is required." });
const respond = handler => async (req, res) => {
  try { res.json(await handler(req)); }
  catch (error) {
    res.status(error.statusCode || 503).json({
      success: false, code: error.code && typeof error.code === "string" ? error.code : "REFUND_UNAVAILABLE",
      message: error.statusCode ? error.message : "Refund status is unavailable. Retry only the same request key or refresh history; do not submit a new refund.",
    });
  }
};
const authorizedOperations = req => req.user?.role === "STAFF" && req.user?.isStaff === true &&
  req.staffAccess?.roleName === "OPERATIONS_MANAGER" && req.staffAccess?.scope?.type === "GLOBAL" &&
  req.staffAccess?.permissions?.includes("operations.workspace.view");
const refundRead = (req, res, next) => authorizedOperations(req) ? next() :
  headOffice(req, res, () => requirePermission("finance.view")(req, res, next));
const refundWrite = (req, res, next) => authorizedOperations(req)
  ? requireExplicitPermission("operations.refund")(req, res, next)
  : requireExplicitPermission("transactions.refund")(req, res, next);
router.use(protect, loadStaffRole, refundRead);
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/history", respond(async req => ({ success: true, ...await service.history(req.query) })));
router.get("/transactions/:id", respond(async req => ({
  success: true, transaction: await service.detail(req.params.id),
  canExecute: req.staffRole?.permissions?.includes(authorizedOperations(req) ? "operations.refund" : "transactions.refund") === true,
})));
router.post("/transactions/:id/refund", refundWrite, respond(req => refund(req.params.id, {
  reason: req.body?.reason, confirmation: req.body?.confirmation,
  providerRiskAcknowledged: req.body?.providerRiskAcknowledged,
  idempotencyKey: req.get("X-Idempotency-Key") || req.body?.idempotencyKey,
}, req.user, authorizedOperations(req) ? {
  roleName: req.staffAccess.roleName, scope: req.staffAccess.scope,
  explicitPermissions: req.staffRole.permissions,
} : undefined)));
module.exports = router;
module.exports.headOffice = headOffice;
module.exports.authorizedOperations = authorizedOperations;
module.exports.refundRead = refundRead;
module.exports.refundWrite = refundWrite;
