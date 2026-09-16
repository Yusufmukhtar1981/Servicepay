const express = require("express");
const controller = require("../controllers/edupay.controller");
const { customer, school, headOffice } = require("../middleware/edupay.middleware");
const router = express.Router();

// Public/safe entry points.
router.post("/schools/apply", controller.applySchool);
router.post("/school/auth/login", controller.schoolLogin);
router.get("/sponsor/:token", controller.sponsorView);
router.post("/sponsor/:token/contribute", controller.sponsorContribute);
router.get("/schools", controller.listSchools);
router.get("/schools/:schoolId/fees", controller.listFees);

router.get("/dashboard", ...customer, controller.dashboard);
router.get("/children", ...customer, controller.listChildren);
router.post("/children", ...customer, controller.createChild);
router.patch("/children/:childId", ...customer, controller.updateChild);
router.get("/plans", ...customer, controller.listPlans);
router.post("/plans", ...customer, controller.createPlan);
router.get("/plans/:planId", ...customer, controller.getPlan);
router.post("/plans/:planId/contributions", ...customer, controller.contribute);
router.patch("/plans/:planId/autosave", ...customer, controller.autosave);
router.post("/plans/:planId/sponsor-invites", ...customer, controller.inviteSponsor);
router.get("/history", ...customer, controller.history);
router.get("/repayments", ...customer, controller.repayments);
router.post("/repayments/:repaymentId/payments", ...customer, controller.repay);
router.get("/receipts/:reference", ...customer, controller.receipt);

router.get("/school/dashboard", ...school, controller.schoolDashboard);
router.get("/school/profile", ...school, controller.schoolProfile);
router.get("/school/sessions", ...school, controller.schoolSessions);
router.post("/school/sessions", ...school, controller.schoolCreateSession);
router.post("/school/terms", ...school, controller.schoolCreateTerm);
router.post("/school/classes", ...school, controller.schoolCreateClass);
router.post("/school/fees", ...school, controller.schoolCreateFee);
router.get("/school/students", ...school, controller.schoolStudents);
router.get("/school/settlements", ...school, controller.schoolSettlements);

module.exports = router;