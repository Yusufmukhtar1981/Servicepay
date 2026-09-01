const express = require("express");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const controller = require("../controllers/fintechOperations.controller");
const adminController = require("../controllers/adminFintechOperations.controller");

const router = express.Router();
router.use(protect, adminOnly("HEAD_OFFICE"));
router.get("/catalog", controller.catalog);
router.route("/cases").get(controller.listCases).post(controller.createCase);
router.route("/cases/:id").get(controller.getCase).patch(controller.updateCase);
router.route("/risk-alerts").get(controller.listAlerts).post(controller.createAlert);
router.patch("/risk-alerts/:id", controller.updateAlert);
router.route("/scheduled-payments").get(controller.listPayments).post(controller.createPayment);
router.patch("/scheduled-payments/:id", controller.updatePayment);
router.post("/scheduled-payments/:id/execute", controller.executePayment);
router.route("/providers").get(controller.providers).patch(controller.providers);
router.get("/reports/:type", controller.report);
router.get("/kyb", controller.kyb);
router.get("/identity-verifications", controller.identityVerifications);

router.get("/customers", adminController.searchCustomers);
router.get("/customers/:id", adminController.getCustomerOperations);
router.post("/restrictions", adminController.createRestriction);
router.delete("/restrictions/:id", adminController.removeRestriction);
router.route("/wallet-holds")
  .get(adminController.listWalletHolds)
  .post(adminController.createWalletHold);
router.post("/wallet-holds/:id/release", adminController.releaseWalletHold);
router.get("/failed-transactions", adminController.listFailedTransactions);
router.post("/failed-transactions/:id/investigate", adminController.markTransactionInvestigation);
router.get("/virtual-accounts", adminController.listVirtualAccounts);
router.get("/dedicated-accounts", adminController.listDedicatedAccounts);
router.get("/bank-partners", adminController.listBankPartners);
router.get("/routing-status", adminController.listRoutingStatus);
router.get("/fraud-alerts", adminController.listFraudAlerts);
router.patch("/fraud-alerts/:id", adminController.updateFraudAlert);
router.route("/watchlist")
  .get(adminController.listWatchlist)
  .post(adminController.createWatchlistEntry);
router.post("/watchlist/:id/clear", adminController.clearWatchlistEntry);
router.get("/login-risk", adminController.listLoginRisk);
router.get("/financial-actions", adminController.listFinancialActions);
router.post("/financial-actions/:type", adminController.executeFinancialAction);
router.route("/disputes")
  .get(adminController.listDisputes)
  .post(adminController.createDispute);
router.patch("/disputes/:id", adminController.updateDispute);
module.exports = router;