const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const controller = require(
  "../controllers/adminRoleUsers.controller"
);

const router = express.Router();

router.get(
  "/",
  protect,
  controller.getRoleUsers
);

router.get(
  "/:userId",
  protect,
  controller.getRoleUserById
);

router.put(
  "/:userId/status",
  protect,
  controller.updateRoleUserStatus
);

router.delete(
  "/:userId",
  protect,
  controller.safeDeleteRoleUser
);

module.exports = router;
