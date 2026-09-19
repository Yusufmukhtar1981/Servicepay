const express = require("express");
const multer = require("multer");
const controller = require("../controllers/edupay.controller");
const { customer, school, headOffice } = require("../middleware/edupay.middleware");
const academic = require("../controllers/edupayAcademic.controller");
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

// Academic management is intentionally isolated from the existing finance
// handlers above. Every endpoint still passes the existing school membership
// middleware, while the controller enforces manager/teacher/parent scope.
router.get("/school/academic/dashboard", ...school, academic.dashboard);
router.get("/school/academic", ...school, academic.listAcademic);
router.post("/school/academic/sessions", ...school, academic.createSession);
router.patch("/school/academic/sessions/:sessionId", ...school, academic.updateSession);
router.post("/school/academic/terms", ...school, academic.createTerm);
router.post("/school/academic/classes", ...school, academic.createClass);
router.post("/school/academic/subjects", ...school, academic.createSubject);
router.get("/school/academic/students", ...school, academic.listStudents);
router.post("/school/academic/students", ...school, academic.createStudent);
router.patch("/school/academic/students/:studentId", ...school, academic.updateStudent);
router.post("/school/academic/students/import/validate", ...school, academic.validateStudentImport);
router.post("/school/academic/students/import/commit", ...school, academic.commitStudentImport);
router.get("/school/academic/teachers", ...school, academic.listTeachers);
router.post("/school/academic/teachers", ...school, academic.createTeacher);
router.post("/school/academic/teachers/assignments", ...school, academic.assignTeacher);
router.get("/school/academic/attendance/roster", ...school, academic.attendanceRoster);
router.post("/school/academic/attendance", ...school, academic.submitAttendance);
router.post("/school/academic/assessments", ...school, academic.createAssessment);
router.get("/school/academic/assessments", ...school, academic.listAssessments);
router.put("/school/academic/assessments/:assessmentId/scores", ...school, academic.saveScores);
router.post("/school/academic/assessments/:assessmentId/review", ...school, academic.reviewAssessment);
router.post("/school/academic/timetable", ...school, academic.createTimetable);
router.get("/school/academic/timetable", ...school, academic.listTimetable);
router.post("/school/academic/activities", ...school, academic.createActivity);
router.get("/school/academic/activities", ...school, academic.listActivities);
router.get("/academic/children", ...customer, academic.parentAcademicChildren);
router.get("/children/:childId/academic/attendance", ...customer, academic.parentAttendance);
router.get("/children/:childId/academic/results", ...customer, academic.parentResults);
router.get("/children/:childId/academic/activities", ...customer, academic.parentActivities);
router.get("/children/:childId/academic/timetable", ...customer, academic.parentTimetable);

module.exports = router;