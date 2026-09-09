const express = require("express");
const router = express.Router();

const {
  buyAirtime,
  buyData,
} = require("../controllers/clubkonnect.controller");

router.post("/airtime", buyAirtime);
router.post("/data", buyData);

module.exports = router;
