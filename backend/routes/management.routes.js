const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const {
  createStateManager,
  getStateManagers,
  createAgent,
  getAgents,
} = require(
  "../controllers/management.controller"
);

const router = express.Router();

router.use(protect);

router
  .route("/state-managers")
  .get(getStateManagers)
  .post(createStateManager);


router
  .route("/agents")
  .get(getAgents)
  .post(createAgent);

module.exports = router;
