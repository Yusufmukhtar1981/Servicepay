const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const controller = require("../controllers/featureControl.controller");

const router = express.Router();

router.get("/config", controller.customer);
router.get("/public", controller.customer);
router.get("/", controller.customer);

router.get("/admin", protect, loadStaffRole, requirePermission("feature_control.view"), controller.registry);
router.get("/admin/features", protect, loadStaffRole, requirePermission("feature_control.view"), controller.registry);
router.get("/admin/audit", protect, loadStaffRole, requirePermission("feature_control.view"), controller.audit);
router.get("/admin/:key/audit", protect, loadStaffRole, requirePermission("feature_control.view"), controller.audit);
router.patch("/admin/bulk", protect, loadStaffRole, requirePermission("feature_control.manage"), controller.bulk);
router.patch("/admin/:key", protect, loadStaffRole, requirePermission("feature_control.manage"), controller.patch);
router.post("/admin/bulk", protect, loadStaffRole, requirePermission("feature_control.manage"), controller.bulk);

module.exports = router;