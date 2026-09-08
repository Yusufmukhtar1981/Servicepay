const express = require("express");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const controller = require("../controllers/adminCommunications.controller");

const router = express.Router();
router.use(protect, adminOnly("HEAD_OFFICE"));
router.get("/capabilities", controller.capabilities);
router.get("/customers", controller.customers);
router.post("/audience/preview", controller.previewAudience);
router.post("/email/test", controller.testEmail);
router.post("/email/broadcast", controller.broadcastEmail);
router.get("/email/history", (req, res) => { req.params.channel = "EMAIL"; return controller.history(req, res); });
router.get("/email/history/:id", (req, res) => { req.params.channel = "EMAIL"; return controller.historyDetail(req, res); });
router.post("/notifications/broadcast", controller.broadcastNotifications);
router.get("/notifications/history", (req, res) => { req.params.channel = "IN_APP"; return controller.history(req, res); });
router.get("/notifications/history/:id", (req, res) => { req.params.channel = "IN_APP"; return controller.historyDetail(req, res); });

module.exports = router;