const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const {
  createOrganization,
  listOrganizations,
  getOrganization,
  updateOrganization,
  createProgram,
  addBeneficiary,
  listPrograms,
  getProgram,
  updateProgram,
  listBeneficiaries,
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
  createDisbursementPreview,
  disburseProgram,
  disburseBeneficiary,
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

router.post(
  "/organizations",
  createOrganization
);

router.get(
  "/organizations",
  listOrganizations
);

router.get(
  "/organizations/:id",
  getOrganization
);

router.patch(
  "/organizations/:id",
  updateOrganization
);

router.post(
  "/programs",
  createProgram
);

router.get(
  "/programs",
  listPrograms
);

router.get(
  "/programs/:programId",
  getProgram
);

router.patch(
  "/programs/:programId",
  updateProgram
);

router.post(
  "/beneficiaries",
  addBeneficiary
);

router.get(
  "/programs/:programId/beneficiaries",
  listBeneficiaries
);


router.patch(
  "/organizations/:id/status",
  updateOrganizationStatus
);

router.patch(
  "/programs/:id/status",
  updateProgramStatus
);

router.patch(
  "/beneficiaries/:id/status",
  updateBeneficiaryStatus
);

router.patch(
  "/beneficiaries/:id/verify",
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
  bulkAddBeneficiaries
);

router.get(
  "/programs/:programId/statistics",
  getProgramStatistics
);

router.get(
  "/programs/:programId/report",
  getProgramReport
);

router.post(
  "/programs/:programId/funding",
  fundProgram
);


router.post(
  "/programs/:programId/disbursement-preview",
  createDisbursementPreview
);

router.get(
  "/programs/:programId/disbursements",
  listDisbursementBatches
);

router.post(
  "/programs/:programId/disbursements",
  disburseProgram
);

router.post(
  "/programs/:programId/beneficiaries/:beneficiaryId/disbursement",
  disburseBeneficiary
);

router.post(
  "/disbursement-batches/:batchId/prepare",
  prepareDisbursementBatch
);

router.get(
  "/programs/:programId/disbursement-batches",
  listDisbursementBatches
);


router.get(
  "/dashboard-summary",
  getEmpowermentDashboardSummary
);

router.get(
  "/audit-trail",
  getEmpowermentAuditTrail
);

module.exports = router;
