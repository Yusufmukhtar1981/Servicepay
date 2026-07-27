const express = require("express");

const {
  buyAirtime,
  buyData,
} = require("../controllers/clubkonnect.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/airtime", protect, buyAirtime);
router.post("/data", protect, buyData);

module.exports = router;