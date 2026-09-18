const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const controller = require("../controllers/biometric.controller");
const router = express.Router();
router.post("/enroll", protect, controller.enroll);
router.post("/login", controller.login);
router.post("/grant", protect, controller.grant);
router.get("/devices", protect, controller.devices);
router.get("/devices/current", protect, controller.currentDevice);
router.patch("/devices/:deviceId", protect, controller.toggle);
router.post("/devices/:deviceId/disable", protect, (req, res) => {
  req.body.disabled = true;
  return controller.toggle(req, res);
});
router.post("/logout", protect, controller.logout);
router.post("/revoke", protect, controller.logout);
module.exports = router;