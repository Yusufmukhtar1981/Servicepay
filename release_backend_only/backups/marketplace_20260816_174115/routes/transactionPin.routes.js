const express = require("express");

const {
  getTransactionPinStatus,
  createTransactionPin,
  verifyTransactionPin,
  changeTransactionPin,
} = require(
  "../controllers/transactionPin.controller"
);

const {
  protect,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(protect);

router.get(
  "/status",
  getTransactionPinStatus
);

router.post(
  "/create",
  createTransactionPin
);

router.post(
  "/verify",
  verifyTransactionPin
);

router.put(
  "/change",
  changeTransactionPin
);

module.exports = router;