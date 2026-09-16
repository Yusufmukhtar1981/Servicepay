const express = require("express");
const multer = require("multer");
const controller = require("../controllers/edupay.controller");
const { customer, school, headOffice } = require("../middleware/edupay.middleware");
const router = express.Router();
const schoolUpload = (req, res, next) => {
  if (!req.is("multipart/form-data")) return res.status(410).json({ success: false, code: "MULTIPART_REQUIRED", message: "School applications require multipart uploads." });
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 11, fieldSize: 64 * 1024 } }).fields([{ name: "logo", maxCount: 1 }, { name: "supportingDocuments", maxCount: 10 }])(req, res, next);
};

// Public/safe entry points.
router.post("/schools/apply", schoolUpload, controller.applySchoolMultipartDirect);
router.post("/school/auth/login", controller.schoolLogin);
// A school discovery request is non-financial onboarding and must remain
// available while EduPay initiation is paused.
router.post("/school-requests", ...customer, controller.createSchoolRequest);
router.get("/sponsor/:token", controller.sponsorView);
router.post("/sponsor/:token/contribute", ...customer, controller.sponsorContribute);
router.get("/schools", controller.listSchools);
router.get("/schools/:schoolId/fees", controller.listFees);
router.get("/schools/:schoolId/catalogue", controller.schoolCatalogue);

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
router.get("/school/terms", ...school, controller.schoolTerms);
router.get("/school/classes", ...school, controller.schoolClasses);
router.get("/school/fees", ...school, controller.schoolFees);
router.post("/school/sessions", ...school, controller.schoolCreateSession);
router.post("/school/terms", ...school, controller.schoolCreateTerm);
router.post("/school/classes", ...school, controller.schoolCreateClass);
router.post("/school/fees", ...school, controller.schoolCreateFee);
router.get("/school/students", ...school, controller.schoolStudents);
router.get("/school/settlements", ...school, controller.schoolSettlements);
router.get("/school/reconciliation", ...school, controller.schoolReconciliation);
router.get("/school/reports", ...school, controller.schoolReport);

module.exports = router;