const express = require("express");

const {
  chat,
  getHistory,
  deleteHistory,
} = require("../controllers/aiSupport.controller");
const { protect } = require("../middleware/auth.middleware");
const {
  aiSupportCustomerOnly,
  aiSupportRateLimit,
} = require("../middleware/aiSupportRateLimit.middleware");

const router = express.Router();

router.get("/history", protect, aiSupportCustomerOnly, getHistory);
router.delete("/history", protect, aiSupportCustomerOnly, deleteHistory);
router.post(
  "/chat",
  protect,
  aiSupportCustomerOnly,
  aiSupportRateLimit,
  chat
);

module.exports = router;