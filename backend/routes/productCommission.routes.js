const express = require("express");

const router = express.Router();

const { protect } = require(
  "../middleware/auth.middleware"
);

const {
  getProductCommissions,
  upsertProductCommission,
  updateProductCommissionStatus,
  deleteProductCommission,
} = require(
  "../controllers/productCommission.controller"
);

const headOfficeOnly = (
  req,
  res,
  next
) => {
  const role = String(
    req.user?.role || ""
  ).toUpperCase();

  if (role !== "HEAD_OFFICE") {
    return res.status(403).json({
      success: false,
      message:
        "Only Head Office can manage product commissions.",
    });
  }

  next();
};

router.use(protect);
router.use(headOfficeOnly);

router.get(
  "/",
  getProductCommissions
);

router.post(
  "/",
  upsertProductCommission
);

router.patch(
  "/:id/status",
  updateProductCommissionStatus
);

router.delete(
  "/:id",
  deleteProductCommission
);

module.exports = router;
