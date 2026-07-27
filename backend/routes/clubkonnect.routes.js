const express = require("express");

const {
  buyAirtime,
  buyData,
} = require("../controllers/clubkonnect.controller");

const router = express.Router();

router.post("/airtime", buyAirtime);
router.post("/data", buyData);

module.exports = router;