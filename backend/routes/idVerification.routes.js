const express = require("express");
const router = express.Router();

const {
  verifyNin,
  getNinVerificationHistory,
  getSingleNinVerification,
} = require("../controllers/idVerification.controller");

const { protect } = require("../middlewares/auth.middleware");

router.post("/nin", protect, verifyNin);
router.get("/nin/history", protect, getNinVerificationHistory);
router.get("/nin/:id", protect, getSingleNinVerification);

module.exports = router;