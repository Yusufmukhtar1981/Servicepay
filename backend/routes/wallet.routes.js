const express = require("express");

const router = express.Router();

const {
  getWallet,
} = require("../controllers/wallet.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

router.get("/", protect, getWallet);

module.exports = router;