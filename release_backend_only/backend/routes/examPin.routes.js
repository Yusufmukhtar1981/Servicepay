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

router.get(
  "/products",
  protect,
  getExamPinProducts
);

router.post(
  "/buy",
  protect,
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