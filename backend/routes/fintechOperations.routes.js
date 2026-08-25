const express = require("express");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const controller = require("../controllers/fintechOperations.controller");

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
module.exports = router;