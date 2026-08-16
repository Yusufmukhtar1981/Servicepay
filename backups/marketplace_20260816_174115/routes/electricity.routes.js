const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const AppSettings = require(
  "../models/appSettings.model"
);

const electricityController = require(
  "../controllers/electricity.controller"
);

const router = express.Router();

/*
 * Check whether Electricity is enabled
 * from the ServicePay Admin Settings.
 */
const electricityEnabled = async (
  req,
  res,
  next
) => {
  try {
    const settings =
      await AppSettings.findOne({
        key: "GLOBAL_SETTINGS",
      }).lean();

    /*
     * Keep the service enabled when settings
     * have not yet been created.
     */
    if (!settings) {
      return next();
    }

    if (
      settings.platform?.maintenanceMode ===
      true
    ) {
      return res.status(503).json({
        success: false,
        code: "MAINTENANCE_MODE",
        message:
          "ServicePay is temporarily under maintenance. Please try again later.",
      });
    }

    if (
      settings.services
        ?.electricityEnabled === false
    ) {
      return res.status(503).json({
        success: false,
        code:
          "ELECTRICITY_SERVICE_DISABLED",
        message:
          "Electricity service is temporarily unavailable.",
      });
    }

    return next();
  } catch (error) {
    console.error(
      "Electricity settings check error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to confirm electricity service availability.",
    });
  }
};

/*
 * Public list of supported DisCos,
 * meter types and payment limits.
 */
router.get(
  "/companies",
  electricityController
    .getElectricityCompanies
);

/*
 * Verify meter and return customer name.
 * Blocked when Electricity is disabled.
 */
router.post(
  "/verify-meter",
  protect,
  electricityEnabled,
  electricityController.verifyMeter
);

/*
 * Pay electricity bill with wallet
 * and transaction PIN.
 * Blocked before wallet debit when
 * Electricity is disabled.
 */
router.post(
  "/pay",
  protect,
  electricityEnabled,
  electricityController.payElectricity
);

/*
 * Nellobyte payment callback.
 * Do not block callbacks, even when the
 * service is disabled or in maintenance.
 */
router.all(
  "/callback",
  electricityController
    .electricityCallback
);

module.exports = router;