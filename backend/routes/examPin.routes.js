const express = require("express");

const {
  getExamPinProducts,
  buyExamPin,
  getExamPinHistory,
  getSingleExamPin,
} = require(
  "../controllers/examPin.controller"
);

const {
  protect,
} = require(
  "../middleware/auth.middleware"
);

const router = express.Router();
const { requireIntegratedBusinessPricing } = require("../middleware/businessPricingAdmission.middleware");

router.get(
  "/products",
  protect,
  getExamPinProducts
);

router.post(
  "/buy",
  protect,
  requireIntegratedBusinessPricing("EXAM_PIN"),
  buyExamPin
);

router.get(
  "/history",
  protect,
  getExamPinHistory
);

router.get(
  "/history/:id",
  protect,
  getSingleExamPin
);

module.exports = router;