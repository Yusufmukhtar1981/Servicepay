const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const electricityController = require(
  "../controllers/electricity.controller"
);

const router = express.Router();

/*
 * Public list of supported DisCos,
 * meter types and payment limits.
 */
router.get(
  "/companies",
  electricityController.getElectricityCompanies
);

/*
 * Verify meter and return customer name.
 */
router.post(
  "/verify-meter",
  protect,
  electricityController.verifyMeter
);

/*
 * Pay electricity bill with wallet
 * and transaction PIN.
 */
router.post(
  "/pay",
  protect,
  electricityController.payElectricity
);

/*
 * Nellobyte payment callback.
 */
router.all(
  "/callback",
  electricityController.electricityCallback
);

module.exports = router;