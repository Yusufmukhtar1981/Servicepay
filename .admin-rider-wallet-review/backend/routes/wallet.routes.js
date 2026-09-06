const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth.middleware");
const {
  getWallet,
  getWalletHistory,
} = require("../controllers/wallet.controller");

router.get("/", protect, getWallet);
router.get("/history", protect, getWalletHistory);

module.exports = router;
