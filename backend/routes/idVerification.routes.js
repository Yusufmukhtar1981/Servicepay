const express = require("express");
const router = express.Router();

const {
  verifyNin,
  getNinVerificationHistory,
  getSingleNinVerification,

  verifyBvn,
  getBvnVerificationHistory,
  getSingleBvnVerification,
} = require("../controllers/idVerification.controller");

const protect = require("../middleware/auth.middleware");

// NIN verification routes
router.post(
  "/nin",
  protect,
  verifyNin
);

router.get(
  "/nin/history",
  protect,
  getNinVerificationHistory
);

router.get(
  "/nin/:id",
  protect,
  getSingleNinVerification
);

// BVN verification routes
router.post(
  "/bvn",
  protect,
  verifyBvn
);

router.get(
  "/bvn/history",
  protect,
  getBvnVerificationHistory
);

router.get(
  "/bvn/:id",
  protect,
  getSingleBvnVerification
);

module.exports = router;
