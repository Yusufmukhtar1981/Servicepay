const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const service = require("../services/pendingResolution.service");
const monitor = require("../services/pendingResolutionMonitor.service");
const refund = require("../services/manualRefund.service").createRefundService().refund;
const recheck = service.createRechecker();
router.use(protect, loadStaffRole);
router.use((req, res, next) => service.permissions(req).view ? next() :
  res.status(403).json({ success: false, code: "RESOLUTION_ACCESS_DENIED", message: "Authorized global Head Office or Operations access required." }));
router.use(require("../middleware/adminAccessLog.middleware"));
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const run = fn => async (req, res) => {
  try {
    const output = await fn(req);
    res.status(output?.data?.state === "PROCESSING" ? 202 : 200).json(output);
  } catch (error) {
    res.status(error.statusCode || 503).json({ success: false,
      code: error.statusCode ? error.code : "RESOLUTION_UNAVAILABLE",
      message: error.statusCode ? error.message : "Resolution could not be confirmed. Preserve the original request and key; refresh authoritative history before retrying." });
  }
};
router.get("/summary", run(async () => ({ success: true, data: { ...await service.summary(), monitor: monitor.status() } })));
router.get("/transactions", run(async req => ({ success: true, data: await service.list(req.query) })));
router.get("/transactions/:id", run(async req => ({ success: true, data: await service.detail(req.params.id, req) })));
router.post("/transactions/:id/resolve", run(async req => {
  const body = { ...req.body, idempotencyKey: req.get("X-Idempotency-Key") || req.body?.idempotencyKey };
  if (body.action === "MARK_SUCCESSFUL") return service.markSuccessful(req.params.id, body, req);
  if (body.action !== "REFUND") throw service.fail(400, "INVALID_ACTION", "Choose a supported resolution action.");
  if (!service.permissions(req).refund) throw service.fail(403, "REFUND_PERMISSION_REQUIRED", "Explicit refund permission required.");
  const auth = req.user.role === "STAFF" ? { roleName: req.staffAccess.roleName,
    scope: req.staffAccess.scope, explicitPermissions: req.staffRole.permissions } : undefined;
  return { success: true, data: await refund(req.params.id, body, req.user, auth) };
}));
router.post("/transactions/:id/retry", run(req => recheck(req.params.id,
  { ...req.body, idempotencyKey: req.get("X-Idempotency-Key") || req.body?.idempotencyKey }, req)));
module.exports = router;
