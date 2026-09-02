const express = require("express");

const {
  protect,
  adminOnly,
} = require(
  "../middleware/auth.middleware"
);

const kekeFareSettingController =
  require(
    "../controllers/kekeFareSetting.controller"
  );

const router = express.Router();

/*
 * =====================================================
 * ADMIN - KEKE FARE SETTINGS
 * =====================================================
 *
 * These routes are protected.
 *
 * Later we can add stricter HEAD_OFFICE-only
 * middleware if required.
 */

/*
 * GET /api/admin/keke-fare
 */
router.get(
  "/",
  protect,
  adminOnly("HEAD_OFFICE"),
  kekeFareSettingController
    .adminGetFareSettings
);

/*
 * POST /api/admin/keke-fare
 */
router.post(
  "/",
  protect,
  adminOnly("HEAD_OFFICE"),
  kekeFareSettingController
    .adminSaveFareSetting
);

/*
 * DELETE /api/admin/keke-fare/:id
 */
router.delete(
  "/:id",
  protect,
  adminOnly("HEAD_OFFICE"),
  kekeFareSettingController
    .adminDeleteFareSetting
);

module.exports = router;