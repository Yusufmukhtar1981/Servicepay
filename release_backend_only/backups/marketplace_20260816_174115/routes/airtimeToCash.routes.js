const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const {
  getSettings,
  createRequest,
  myRequests,
  adminList,
  approveRequest,
  rejectRequest,
} = require(
  "../controllers/airtimeToCash.controller"
);

const router = express.Router();

router.get(
  "/settings",
  protect,
  getSettings
);

router.post(
  "/request",
  protect,
  createRequest
);

router.get(
  "/my-requests",
  protect,
  myRequests
);

router.get(
  "/admin/requests",
  protect,
  adminList
);

router.post(
  "/admin/:id/approve",
  protect,
  approveRequest
);

router.post(
  "/admin/:id/reject",
  protect,
  rejectRequest
);

module.exports = router;
