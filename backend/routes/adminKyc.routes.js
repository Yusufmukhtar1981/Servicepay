const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const adminKycController = require(
  "../controllers/adminKyc.controller"
);

const router = express.Router();

const headOfficeOnly = (req, res, next) => {
  if (
    String(req.user?.role || "").toUpperCase() !==
    "HEAD_OFFICE"
  ) {
    return res.status(403).json({
      success: false,
      message: "Head Office access is required.",
    });
  }

  next();
};

router.use(protect);
router.use(headOfficeOnly);

router.get(
  "/",
  adminKycController.getKycApplications
);

router.get(
  "/:kycId",
  adminKycController.getKycApplication
);

router.get(
  "/:kycId/document/:documentType",
  adminKycController.getKycDocument
);

router.patch(
  "/:kycId/status",
  adminKycController.updateKycStatus
);

module.exports = router;
