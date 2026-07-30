const express = require("express");

const router = express.Router();

const {
  getPublicSettings,
  getAdminSettings,
  updateAdminSettings,
} = require(
  "../controllers/appSettings.controller"
);

const protect = require(
  "../middleware/auth.middleware"
);

router.get(
  "/public",
  getPublicSettings
);

router.get(
  "/admin",
  protect,
  getAdminSettings
);

router.put(
  "/admin",
  protect,
  updateAdminSettings
);

module.exports = router;
