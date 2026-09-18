const express = require("express");
const controller = require("../controllers/edupayActivity.controller");
const { customer, school } = require("../middleware/edupay.middleware");
const router = express.Router();

router.get("/school/records", ...school, controller.schoolList);
router.post("/school/records/:type", ...school, controller.schoolCreate);
router.post("/school/attendance", ...school, (req, res, next) => { req.params.type = "ATTENDANCE"; return controller.schoolCreate(req, res, next); });
router.post("/school/results", ...school, (req, res, next) => { req.params.type = "RESULT"; return controller.schoolCreate(req, res, next); });
router.post("/school/assignments", ...school, (req, res, next) => { req.params.type = "ASSIGNMENT"; return controller.schoolCreate(req, res, next); });
router.post("/school/activities", ...school, (req, res, next) => { req.params.type = "ACTIVITY"; return controller.schoolCreate(req, res, next); });
router.post("/school/conduct", ...school, (req, res, next) => { req.params.type = "CONDUCT"; return controller.schoolCreate(req, res, next); });
router.post("/school/announcements", ...school, (req, res, next) => { req.params.type = "ANNOUNCEMENT"; return controller.schoolCreate(req, res, next); });
router.patch("/school/records/:recordId", ...school, controller.schoolUpdate);
router.post("/school/records/:recordId/publish", ...school, controller.schoolPublish);
router.post("/school/attendance/bulk", ...school, controller.schoolBulkAttendance);
router.post("/school/guardians/invites", ...school, controller.schoolGuardianInvite);
router.post("/school/guardians/invites/:inviteId/revoke", ...school, controller.schoolGuardianRevoke);
router.get("/parent/children", ...customer, controller.parentChildren);
router.post("/parent/guardian-links/accept", ...customer, controller.parentGuardianAccept);
router.get("/parent/children/:childId/dashboard", ...customer, controller.parentDashboard);
router.get("/parent/children/:childId/timeline", ...customer, controller.parentList);
router.get("/parent/children/:childId/summary", ...customer, controller.parentSummary);
router.get("/parent/children/:childId/results", ...customer, controller.parentReport);
router.get("/parent/children/:childId/:type", ...customer, controller.parentList);

module.exports = router;