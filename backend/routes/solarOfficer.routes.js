const express = require("express");
const { protect, solarOfficerOnly } = require("../middleware/auth.middleware");
const { loadStaffRole, requireAnyPermission, enforceActiveBranchScope, requireAssignedBranchModule } = require("../middleware/staffPermission.middleware");
const { requireSolarBranchModule } = require("../middleware/solarBranch.middleware");
const controller = require("../controllers/solarOfficer.controller");

const router = express.Router();
const admins = [
  loadStaffRole,
  requireAnyPermission("SOLAR_VIEW", "SOLAR_MANAGE", "BRANCH_SOLAR_VIEW", "BRANCH_SOLAR_MANAGE"),
  enforceActiveBranchScope,
  requireAssignedBranchModule("SOLAR"),
];
const officer = [protect, solarOfficerOnly, requireSolarBranchModule];

router.get("/me", ...officer, controller.officerMe);
router.get("/dashboard", ...officer, controller.officerDashboard);
router.get("/applications", ...officer, controller.officerApplications);
router.get("/applications/:applicationId", ...officer, controller.officerApplications);
router.post("/applications/:applicationId/verification", ...officer, controller.officerVerifyApplication);
router.post("/applications/:applicationId/handover", ...officer, controller.officerHandover);
router.get("/repayments", ...officer, controller.officerRepayments);
router.get("/overdue", ...officer, controller.officerOverdue);
router.post("/applications/:applicationId/follow-ups", ...officer, controller.officerFollowUp);
router.get("/commissions", ...officer, controller.officerCommissions);
router.get("/withdrawals", ...officer, controller.officerWithdrawals);
router.post("/withdrawals", ...officer, controller.officerCreateWithdrawal);
router.get("/performance", ...officer, controller.officerPerformance);

router.get("/admin/dashboard", protect, admins, controller.adminOfficerDashboard);
router.get("/admin/officers", protect, admins, controller.adminListOfficers);
router.post("/admin/officers", protect, admins, controller.adminCreateOfficer);
router.patch("/admin/officers/:officerId/status", protect, admins, controller.adminUpdateOfficerStatus);
router.get("/admin/officers/:officerId/performance", protect, admins, controller.adminOfficerPerformance);
router.get("/admin/assignments", protect, admins, controller.adminListAssignments);
router.post("/admin/applications/:applicationId/assign", protect, admins, controller.adminAssignApplication);
router.get("/admin/withdrawals", protect, admins, controller.adminListWithdrawals);
router.patch("/admin/withdrawals/:withdrawalId/approve", protect, admins, controller.adminApproveWithdrawal);
router.patch("/admin/withdrawals/:withdrawalId/reject", protect, admins, controller.adminRejectWithdrawal);
router.patch("/admin/withdrawals/:withdrawalId/paid", protect, admins, controller.adminPayWithdrawal);

module.exports = router;