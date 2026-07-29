const express = require("express");

const router = express.Router();

const {
  getBanks,
  validateAccountName,
  generateVirtualAccount,
} = require("../controllers/securewave.controller");

router.get("/banks", getBanks);

router.post(
  "/validate-account-name",
  validateAccountName
);
router.post(
  "/virtual-account",
  generateVirtualAccount
);

module.exports = router;