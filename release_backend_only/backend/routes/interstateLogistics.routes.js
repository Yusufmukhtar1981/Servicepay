const router = require("express").Router();
const c = require("../controllers/interstateLogistics.controller");
const { protect, customerOnly, adminOnly } = require("../middleware/auth.middleware");
const { requireTransactionPin } = require("../middleware/transactionPin.middleware");
const publicTrackingRateLimit = require("../middleware/publicTrackingRateLimit.middleware");

router.get("/track/:trackingNumber", publicTrackingRateLimit, c.track);
router.get("/routes", protect, customerOnly, c.customerRoutes);
router.get("/config", protect, customerOnly, c.config);
router.post("/quote", protect, customerOnly, c.quote);
router.post("/shipments", protect, customerOnly, c.createShipment);
router.get("/shipments/my", protect, customerOnly, c.myShipments);
router.get("/shipments/:id", protect, customerOnly, c.getShipment);
router.post("/shipments/:id/pay", protect, customerOnly, requireTransactionPin, c.pay);
router.post("/shipments/:id/pay-adjustment", protect, customerOnly, requireTransactionPin, c.paySupplement);
router.post("/shipments/:id/cancel", protect, customerOnly, c.cancel);
// Compatibility aliases for deployed customer clients; canonical routes above remain preferred.
router.post("/:id/pay", protect, customerOnly, requireTransactionPin, c.pay);
router.post("/:id/cancel", protect, customerOnly, c.cancel);
module.exports = router;