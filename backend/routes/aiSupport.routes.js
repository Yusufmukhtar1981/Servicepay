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
const smart = require("../controllers/smartSupport.controller");

router.get("/history", protect, aiSupportCustomerOnly, getHistory);
router.delete("/history", protect, aiSupportCustomerOnly, deleteHistory);
router.post("/escalate", protect, aiSupportCustomerOnly, aiSupportRateLimit, smart.escalate);
router.get("/feedback", protect, aiSupportCustomerOnly, smart.getFeedback);
router.post("/feedback", protect, aiSupportCustomerOnly, aiSupportRateLimit, smart.feedback);
router.get("/records", protect, aiSupportCustomerOnly, aiSupportRateLimit, smart.records);
router.post("/voice/transcribe", protect, aiSupportCustomerOnly, aiSupportRateLimit, express.json({ limit: "4mb" }), smart.transcribe);
router.post("/voice/speech", protect, aiSupportCustomerOnly, aiSupportRateLimit, express.json({ limit: "16kb" }), smart.speech);
router.post(
  "/chat",
  protect,
  aiSupportCustomerOnly,
  aiSupportRateLimit,
  chat
);

module.exports = router;