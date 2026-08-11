const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const controller = require(
  "../controllers/withdrawal.controller"
);

const router = express.Router();

const requireHeadOffice = (req, res, next) => {
  const role =
    String(req.user?.role || "")
      .trim()
      .toUpperCase();

  if (role !== "HEAD_OFFICE") {
    return res.status(403).json({
      success: false,
      message: "Head Office access required.",
    });
  }

  next();
};


router.use(protect);

router.post(
  "/request",
  controller.createWithdrawal
);

router.get(
  "/my",
  controller.myWithdrawals
);

router.get(
  "/admin",
  requireHeadOffice,
  controller.adminWithdrawals
);

router.post(
  "/admin/:id/approve",
  requireHeadOffice,
  controller.approveWithdrawal
);

router.post(
  "/admin/:id/reject",
  requireHeadOffice,
  controller.rejectWithdrawal
);

module.exports = router;
