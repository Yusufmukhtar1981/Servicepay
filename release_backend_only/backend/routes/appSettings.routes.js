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

module.exports = router;
