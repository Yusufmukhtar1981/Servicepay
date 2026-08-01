const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const {
  createStateManager,
  getStateManagers,
  createAgent,
  getAgents,
  createCustomer,
  getCustomers,
  getAgentTransactions,
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


router
  .route("/customers")
  .get(getCustomers)
  .post(createCustomer);


router.get(
  "/agent-transactions",
  getAgentTransactions
);

module.exports = router;
