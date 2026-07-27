const express = require("express");

const {
  buyAirtime,
  buyData,
  getDataPlans,
} = require("../controllers/clubkonnect.controller");

const {
  protect,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.get(
  "/data-plans/:network",
  protect,
  getDataPlans
);

router.post(
  "/airtime",
  protect,
  buyAirtime
);

router.post(
  "/data",
  protect,
  buyData
);

module.exports = router;