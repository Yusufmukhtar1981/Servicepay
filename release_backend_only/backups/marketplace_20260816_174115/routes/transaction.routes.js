const express = require("express");

const {
  getMyTransactions,
  getTransactionById,
} = require(
  "../controllers/transaction.controller"
);

const {
  protect,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.get(
  "/",
  protect,
  getMyTransactions
);

router.get(
  "/:id",
  protect,
  getTransactionById
);

module.exports = router;
