const express = require("express");
const router = express.Router();

const {
  buyAirtime,
} = require("../controllers/nellobytes.controller");

router.post("/airtime", buyAirtime);

module.exports = router;