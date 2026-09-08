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
 * CUSTOMER / APP
 * =====================================================
 */

/*
 * GET /api/keke-fare
 * GET /api/keke-fare?state=KANO
 */
router.get(
  "/",
  protect,
  kekeFareSettingController
    .getFareSetting
);

/*
 * POST /api/keke-fare/estimate
 *
 * Body:
 *
 * {
 *   "distanceKm": 5,
 *   "waitingMinutes": 0,
 *   "state": "Kano"
 * }
 */
router.post(
  "/estimate",
  protect,
  kekeFareSettingController
    .estimateFare
);

module.exports = router;