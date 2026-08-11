const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const controller = require(
  "../controllers/businessWallet.controller"
);

const router = express.Router();

router.get(
  "/",
  protect,
  controller.getBusinessWallet
);

router.post(
  "/fund",
  protect,
  controller.movePersonalToBusiness
);

router.post(
  "/to-personal",
  protect,
  controller.moveBusinessToPersonal
);


router.post(
  "/profile",
  protect,
  controller.setupBusinessWalletIdentity
);

router.post(
  "/resolve",
  protect,
  controller.resolveBusinessBeneficiary
);

router.post(
  "/transfer",
  protect,
  controller.transferBusinessToBusiness
);


router.post(
  "/withdrawals",
  protect,
  controller.requestBusinessWithdrawal
);

router.get(
  "/withdrawals",
  protect,
  controller.getMyBusinessWithdrawals
);

router.get(
  "/admin/withdrawals",
  protect,
  controller.adminListBusinessWithdrawals
);

router.patch(
  "/admin/withdrawals/:id/approve",
  protect,
  controller.adminApproveBusinessWithdrawal
);

router.patch(
  "/admin/withdrawals/:id/reject",
  protect,
  controller.adminRejectBusinessWithdrawal
);

router.patch(
  "/admin/withdrawals/:id/paid",
  protect,
  controller.adminMarkBusinessWithdrawalPaid
);

module.exports = router;
