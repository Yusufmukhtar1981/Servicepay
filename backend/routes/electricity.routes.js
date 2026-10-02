const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");
const {
  requireNoRestriction,
  requireSpendableBalance,
} = require("../middleware/accountRestriction.middleware");

const AppSettings = require(
  "../models/appSettings.model"
);

const electricityController = require(
  "../controllers/electricity.controller"
);

const { electricityProviderEnabled } = require("../middleware/providerRouting.middleware");

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
  electricityProviderEnabled,
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
  requireNoRestriction("BLOCK_BILL_PURCHASES", "BLOCK_WALLET_DEBIT"),
  requireSpendableBalance,
  electricityEnabled,
  electricityProviderEnabled,
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

router.get("/transactions/:id/status", protect, async (req, res) => {
  try {
    const { createTelecomAbodeElectricity } = require("../services/telecomAbodeElectricity.service");
    return res.json(await createTelecomAbodeElectricity().requery(req.user._id || req.user.id, req.params.id));
  } catch (error) {
    return res.status(error.status || 503).json({ success: false, code: error.code || "ELECTRICITY_STATUS_UNAVAILABLE",
      message: error.code ? error.message : "Electricity status is unavailable. Do not resend." });
  }
});
router.post("/quote", protect, electricityEnabled, async (req, res) => {
  try {
    const { createTelecomAbodeElectricity } = require("../services/telecomAbodeElectricity.service");
    return res.json({ success: true, data: await createTelecomAbodeElectricity().quote(req.body.amount) });
  } catch (error) {
    return res.status(error.status || 503).json({ success: false,
      code: error.code || "ELECTRICITY_QUOTE_UNAVAILABLE",
      message: error.code ? error.message : "Electricity quote is unavailable." });
  }
});

module.exports = router;