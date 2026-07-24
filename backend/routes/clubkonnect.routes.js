const express = require("express");
const router = express.Router();

const {
  buyAirtime,
  buyData,
} = require("../controllers/clubkonnect.controller");

const { protect } = require("../middleware/auth.middleware");

router.post("/airtime", protect, buyAirtime);
router.post("/data", protect, buyData);

module.exports = router;