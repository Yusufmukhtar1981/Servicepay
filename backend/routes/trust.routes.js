const express = require("express");

const {
  getMyTrustProfile,
  getTrustProfile,
  searchTrustProfiles,
  updateMyDiscoverability,
} = require("../controllers/trust.controller");
const {
  protect,
} = require("../middleware/auth.middleware");
const {
  trustSearchRateLimit,
} = require("../middleware/trustRateLimit.middleware");
const deals = require("../controllers/protectedDeal.controller");
const { requireTransactionPin } = require("../middleware/transactionPin.middleware");

const router = express.Router();

router.get(
  "/search",
  protect,
  trustSearchRateLimit,
  searchTrustProfiles
);
router.get("/me", protect, getMyTrustProfile);
router.get("/deals", protect, deals.listMine);
router.post("/deals", protect, deals.create);
router.get("/deals/:dealId", protect, deals.getMine);
router.post("/deals/:dealId/fund", protect, requireTransactionPin, deals.fund);
router.post("/deals/:dealId/start", protect, deals.start);
router.post("/deals/:dealId/delivered", protect, deals.delivered);
router.post("/deals/:dealId/release", protect, requireTransactionPin, deals.release);
router.post("/deals/:dealId/disputes", protect, deals.dispute);
router.patch(
  "/me/discoverability",
  protect,
  updateMyDiscoverability
);
router.get(
  "/profiles/:servicePayId",
  protect,
  getTrustProfile
);

module.exports = router;