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
  getDownlineSummary,
  getDownlineTransactions,
} = require(
  "../controllers/management.controller"
);
const zonalHierarchy = require("../controllers/zonalHierarchy.controller");
// The oversight router is owned by the zonal oversight workstream.
const zonalOversight = require("./zonalOversight.routes");

const router = express.Router();

router.use(protect);
// Keep hierarchy paths explicit: generic section routes would swallow zonal
// oversight paths and the existing management APIs below.
for (const section of ["state-managers", "aggregators", "customers"]) {
  router.get(`/zonal/${section}`, (req, res) => {
    req.params.section = section;
    return zonalHierarchy.list(req, res);
  });
  router.get(`/zonal/${section}/:id`, (req, res) => {
    req.params.section = section;
    return zonalHierarchy.detail(req, res);
  });
}
router.get("/zonal/customers/:id/transactions", zonalHierarchy.transactions);
router.post("/zonal/aggregators/:id/promote", zonalHierarchy.promote);
router.use("/zonal", zonalOversight);

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

router.get("/downline/summary", getDownlineSummary);
router.get("/downline/transactions", getDownlineTransactions);
router.get("/downline/transactions/:transactionId", getDownlineTransactions);

module.exports = router;
