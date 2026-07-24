const express = require("express");
const router = express.Router();
const { buyAirtime } = require("../controllers/clubkonnect.controller");
const { protect } = require("../middleware/auth.middleware");
router.post("/airtime", protect, buyAirtime);
module.exports = router;
