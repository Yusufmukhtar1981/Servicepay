const express = require("express");

const {
  getAnnouncement,
  updateAnnouncement,
} = require(
  "../controllers/announcement.controller"
);

const {
  protect,
  adminOnly,
} = require(
  "../middleware/auth.middleware"
);

const router = express.Router();

router.get("/", getAnnouncement);

router.put(
  "/admin",
  protect,
  adminOnly("HEAD_OFFICE"),
  updateAnnouncement
);

module.exports = router;