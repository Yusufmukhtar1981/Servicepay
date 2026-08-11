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

module.exports = router;
