const express = require("express");
const router = express.Router();

const {
  initializePayment,
} = require("../controllers/paystack.controller");

router.post("/initialize", initializePayment);

module.exports = router;