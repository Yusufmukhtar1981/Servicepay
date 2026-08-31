const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requireAnyPermission,
  enforceActiveBranchScope,
  requireAssignedBranchModule,
} = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

const {
  createOrganization,
  listOrganizations,
  getOrganization,
  updateOrganization,
  createProgram,
  addBeneficiary,
  listPrograms,
  getSponsorDashboard,
  getProgram,
  updateProgram,
  listBeneficiaries,
  listEligibleBeneficiaries,
  verifyBeneficiary,
  updateOrganizationStatus,
  updateProgramStatus,
  updateBeneficiaryStatus,
  applyForProgram,
  getMyApplications,
  listAvailablePrograms,
  bulkAddBeneficiaries,
  getProgramStatistics,
  fundProgram,
  listProgramFunding,
  createDisbursementPreview,
  disburseProgram,
  disburseBeneficiary,
  bulkDisburseProgram,
  prepareDisbursementBatch,
  listDisbursementBatches,
  getProgramReport,
  getEmpowermentDashboardSummary,
  getEmpowermentAuditTrail,
} = require(
  "../controllers/empowerment.controller"
);

const router = express.Router();

router.use(protect);

// Customers retain their existing sponsor/application ownership routes. Any
// staff actor, however, must have an active branch, the EMPOWERMENT module,
// and an explicit permission before reaching an administrative surface.
const staffActor = (user) => user?.isStaff === true || [
  "HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER",
].includes(String(user?.role || "").trim().toUpperCase());
const staffAccess = (...permissions) => async (req, res, next) => {
  if (!staffActor(req.user)) return next();
  return loadStaffRole(req, res, () =>
    requireAnyPermission(permissions)(req, res, () =>
      enforceActiveBranchScope(req, res, () =>
        requireAssignedBranchModule("EMPOWERMENT")(req, res, next)
      )
    )
  );
};
const viewAccess = staffAccess(P.EMPOWERMENT_VIEW, P.BRANCH_EMPOWERMENT_VIEW);
const manageAccess = staffAccess(
  P.EMPOWERMENT_MANAGE,
  P.BRANCH_EMPOWERMENT_MANAGE
);

router.post(
  "/organizations",
  manageAccess,
  createOrganization
);

router.get(
  "/organizations",
  viewAccess,
  listOrganizations
);

router.get(
  "/organizations/:id",
  viewAccess,
  getOrganization
);

router.patch(
  "/organizations/:id",
  manageAccess,
  updateOrganization
);

router.post(
  "/programs",
  manageAccess,
  createProgram
);

router.get(
  "/programs",
  viewAccess,
  listPrograms
);

router.get(
  "/sponsor/dashboard",
  viewAccess,
  getSponsorDashboard
);

router.get(
  "/programs/:programId",
  viewAccess,
  getProgram
);

router.patch(
  "/programs/:programId",
  manageAccess,
  updateProgram
);

router.post(
  "/beneficiaries",
  manageAccess,
  addBeneficiary
);

router.get(
  "/programs/:programId/beneficiaries",
  viewAccess,
  listBeneficiaries
);

router.get(
  "/programs/:programId/eligible-beneficiaries",
  viewAccess,
  listEligibleBeneficiaries
);


router.patch(
  "/organizations/:id/status",
  manageAccess,
  updateOrganizationStatus
);

router.patch(
  "/programs/:id/status",
  manageAccess,
  updateProgramStatus
);

router.patch(
  "/beneficiaries/:id/status",
  manageAccess,
  updateBeneficiaryStatus
);

router.patch(
  "/beneficiaries/:id/verify",
  manageAccess,
  verifyBeneficiary
);


router.get(
  "/available-programs",
  listAvailablePrograms
);

router.get(
  "/my-applications",
  getMyApplications
);

router.post(
  "/programs/:programId/apply",
  applyForProgram
);


router.post(
  "/programs/:programId/bulk-beneficiaries",
  manageAccess,
  bulkAddBeneficiaries
);

router.get(
  "/programs/:programId/statistics",
  viewAccess,
  getProgramStatistics
);

router.get(
  "/programs/:programId/report",
  viewAccess,
  getProgramReport
);

router.post(
  "/programs/:programId/fund",
  manageAccess,
  fundProgram
);

// Legacy alias retained for existing clients while they move to /fund.
router.post(
  "/programs/:programId/funding",
  manageAccess,
  fundProgram
);

router.get(
  "/programs/:programId/funding",
  viewAccess,
  listProgramFunding
);

router.post(
  "/programs/:programId/disbursement-preview",
  manageAccess,
  createDisbursementPreview
);

router.get(
  "/programs/:programId/disbursements",
  viewAccess,
  listDisbursementBatches
);

router.post(
  "/programs/:programId/disbursements",
  manageAccess,
  disburseProgram
);

router.post(
  "/programs/:programId/bulk-disbursement",
  manageAccess,
  bulkDisburseProgram
);

router.post(
  "/programs/:programId/beneficiaries/:beneficiaryId/pay",
  manageAccess,
  disburseBeneficiary
);

// Legacy alias retained for existing clients while they move to /pay.
router.post(
  "/programs/:programId/beneficiaries/:beneficiaryId/disbursement",
  manageAccess,
  disburseBeneficiary
);
router.post(
  "/disbursement-batches/:batchId/prepare",
  manageAccess,
  prepareDisbursementBatch
);

router.get(
  "/programs/:programId/disbursement-batches",
  viewAccess,
  listDisbursementBatches
);


router.get(
  "/dashboard-summary",
  viewAccess,
  getEmpowermentDashboardSummary
);

router.get(
  "/audit",
  viewAccess,
  getEmpowermentAuditTrail
);

router.get(
  "/audit-trail",
  viewAccess,
  getEmpowermentAuditTrail
);

module.exports = router;
