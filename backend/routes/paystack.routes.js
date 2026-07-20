const express = require("express");
const router = express.Router();

const {
  initializePayment,
  verifyPayment,
} = require("../controllers/paystack.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

router.post("/initialize", protect, initializePayment);
router.post("/verify", protect, verifyPayment);

module.exports = router;