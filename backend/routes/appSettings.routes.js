const express = require("express");

const {
  getPublicSettings,
  getAdminSettings,
  updateAdminSettings,
} = require(
  "../controllers/appSettings.controller"
);

const {
  protect,
  adminOnly,
} = require(
  "../middleware/auth.middleware"
);

const {
  loadStaffRole,
  requirePermission,
} = require(
  "../middleware/staffPermission.middleware"
);


const {
  getFintechControlSettings,
  updateFintechControlSettings,
} = require(
  "../controllers/fintechControlSettings.controller"
);
const {
  registry: getFeatureRegistry,
  customer: getCustomerFeatureConfiguration,
  patch: patchFeature,
  bulk: bulkFeatureControls,
  audit: getFeatureControlAudit,
} = require("../controllers/featureControl.controller");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| PUBLIC SETTINGS
|--------------------------------------------------------------------------
*/

router.get(
  "/public",
  getPublicSettings
);

// Customer-safe live feature configuration; no internal settings or actor
// information is returned.
router.get("/features", getCustomerFeatureConfiguration);
router.get("/feature-control/config", getCustomerFeatureConfiguration);
router.get("/feature-control", getCustomerFeatureConfiguration);

router.get(
  "/customer/features",
  getCustomerFeatureConfiguration
);

/*
|--------------------------------------------------------------------------
| ADMIN SETTINGS
|--------------------------------------------------------------------------
*/

router.get(
  "/admin",
  protect,
  loadStaffRole,
  requirePermission("settings.view"),
  getAdminSettings
);

router.put(
  "/admin",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAdminSettings
);


/*
 * ---------------------------------------------------------
 * FINTECH CONTROL
 * ---------------------------------------------------------
 */

router.get(
  "/admin/fintech-control",
  protect,
  loadStaffRole,
  requirePermission("settings.view"),
  getFintechControlSettings
);

router.put(
  "/admin/fintech-control",
  protect,
  adminOnly("HEAD_OFFICE"),
  loadStaffRole,
  requirePermission("settings.update"),
  updateFintechControlSettings
);

/*
 * Feature Control Center.  These routes intentionally live under the same
 * settings resource as the existing fintech controls so old clients and
 * persisted settings remain compatible.
 */
router.get(
  "/admin/feature-control",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureRegistry
);
router.get(
  "/admin/feature-control/registry",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureRegistry
);

// Alias retained for API clients that call the collection "features".
router.get(
  "/admin/feature-control/features",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureRegistry
);

router.get(
  "/admin/feature-control/audit",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureControlAudit
);
router.get(
  "/admin/feature-control/:key/audit",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureControlAudit
);

router.patch(
  "/admin/feature-control/:key",
  protect,
  loadStaffRole,
  requirePermission("feature_control.manage"),
  patchFeature
);

router.post(
  "/admin/feature-control/bulk",
  protect,
  loadStaffRole,
  requirePermission("feature_control.manage"),
  bulkFeatureControls
);

// Short collection aliases make the contract easy to consume while keeping
// /admin/feature-control as the canonical path.
router.get(
  "/admin/features",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureRegistry
);
router.get(
  "/admin/features/audit",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureControlAudit
);
router.get(
  "/admin/features/:key/audit",
  protect,
  loadStaffRole,
  requirePermission("feature_control.view"),
  getFeatureControlAudit
);
router.patch(
  "/admin/features/:key",
  protect,
  loadStaffRole,
  requirePermission("feature_control.manage"),
  patchFeature
);
router.post(
  "/admin/features/bulk",
  protect,
  loadStaffRole,
  requirePermission("feature_control.manage"),
  bulkFeatureControls
);

module.exports = router;
