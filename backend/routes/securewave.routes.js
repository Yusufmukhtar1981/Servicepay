const express = require("express");

const router = express.Router();

const {
  getBanks,
} = require("../controllers/securewave.controller");

router.get("/banks", getBanks);

module.exports = router;