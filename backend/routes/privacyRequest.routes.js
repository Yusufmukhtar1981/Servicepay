const express = require("express");
const controller = require("../controllers/privacyRequest.controller");
const { privacyRequestRateLimit } = require("../middleware/privacyRequestRateLimit.middleware");

const router = express.Router();
const allowedOrigins = new Set([
  "https://servicepay.ng",
  "https://www.servicepay.ng",
]);
const requireTrustedOrigin = (req, res, next) => {
  const origin = String(req.headers.origin || "").trim().toLowerCase();
  if (!origin || allowedOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /\.replit\.dev$/.test(origin)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "This privacy request origin is not allowed.",
  });
};

router.post("/account-deletion-requests", requireTrustedOrigin, privacyRequestRateLimit, controller.createAccountDeletionRequest);
router.post("/data-requests", requireTrustedOrigin, privacyRequestRateLimit, controller.createDataRequest);

module.exports = router;