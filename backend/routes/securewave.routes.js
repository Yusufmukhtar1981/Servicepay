const express = require("express");

const router = express.Router();

const {
  getBanks,
  validateAccountName,
} = require("../controllers/securewave.controller");

router.get("/banks", getBanks);

router.post(
  "/validate-account-name",
  validateAccountName
);

module.exports = router;