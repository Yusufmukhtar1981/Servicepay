const express = require("express");

const {
  protect,
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
  kekeFareSettingController
    .adminGetFareSettings
);

/*
 * POST /api/admin/keke-fare
 */
router.post(
  "/",
  protect,
  kekeFareSettingController
    .adminSaveFareSetting
);

/*
 * DELETE /api/admin/keke-fare/:id
 */
router.delete(
  "/:id",
  protect,
  kekeFareSettingController
    .adminDeleteFareSetting
);

module.exports = router;