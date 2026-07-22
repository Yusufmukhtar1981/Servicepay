const express = require("express");
const router = express.Router();

const {
  buyAirtime,
} = require("../controllers/clubkonnect.controller");

router.post("/airtime", buyAirtime);

module.exports = router;