const express = require("express");

const router = express.Router();

const {
  createManualFundingRequest,
  getMyManualFundingRequests,
  getAllManualFundingRequests,
  approveManualFundingRequest,
  rejectManualFundingRequest,
} = require(
  "../controllers/manualfunding.controller"
);

const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");

router.post(
  "/request",
  protect,
  createManualFundingRequest
);

router.get(
  "/my-requests",
  protect,
  getMyManualFundingRequests
);

router.get(
  "/admin/requests",
  protect,
  adminOnly("ADMIN", "HEAD_OFFICE"),
  getAllManualFundingRequests
);

router.patch(
  "/admin/requests/:id/approve",
  protect,
  adminOnly("ADMIN", "HEAD_OFFICE"),
  approveManualFundingRequest
);

router.patch(
  "/admin/requests/:id/reject",
  protect,
  adminOnly("ADMIN", "HEAD_OFFICE"),
  rejectManualFundingRequest
);

module.exports = router;