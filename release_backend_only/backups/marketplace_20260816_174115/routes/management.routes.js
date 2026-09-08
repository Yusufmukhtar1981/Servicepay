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
  getRoleTransactions,
  getRoleCommissions,
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

/*
 * Aggregator is the new public name for Agent.
 * Both routes are retained so older app versions continue working.
 */
router
  .route("/aggregators")
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



router.get(
  "/role-transactions",
  getRoleTransactions
);

router.get(
  "/role-commissions",
  getRoleCommissions
);

module.exports = router;
