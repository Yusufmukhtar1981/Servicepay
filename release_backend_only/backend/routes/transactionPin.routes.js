const express = require("express");

const {
  getTransactionPinStatus,
  createTransactionPin,
  verifyTransactionPin,
  changeTransactionPin,
  resetTransactionPin,
} = require(
  "../controllers/transactionPin.controller"
);

const {
  customerOnly,
  protect,
} = require("../middleware/auth.middleware");
const {
  transactionPinResetRateLimit,
} = require(
  "../middleware/transactionPinResetRateLimit.middleware"
);

const router = express.Router();

router.use(protect);

router.get(
  "/status",
  getTransactionPinStatus
);

router.post(
  "/create",
  transactionPinResetRateLimit,
  createTransactionPin
);

router.post(
  "/verify",
  verifyTransactionPin
);

router.put(
  "/change",
  transactionPinResetRateLimit,
  changeTransactionPin
);

router.post(
  "/reset",
  customerOnly,
  transactionPinResetRateLimit,
  resetTransactionPin
);

module.exports = router;