const express = require("express");
const c = require("../controllers/branch.controller");
const {
  getAdminDeliveries,
  assignRiderToDelivery,
  unassignRiderFromDelivery,
  reassignRiderToDelivery,
} = require("../controllers/admin.controller");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requireAnyPermission, enforceActiveBranchScope, requireAssignedBranchModule, STAFF_PERMISSIONS: P } = require("../middleware/staffPermission.middleware");
const router = express.Router();
router.use(protect, loadStaffRole, enforceActiveBranchScope);
router.route("/").get(requireAnyPermission(P.BRANCHES_VIEW, P.BRANCH_DASHBOARD_VIEW), c.list).post(requireAnyPermission(P.BRANCHES_MANAGE), c.create);
router.get("/overview", requireAnyPermission(P.BRANCH_DASHBOARD_VIEW, P.BRANCHES_VIEW), c.overview);
router.get("/dashboard", requireAnyPermission(P.BRANCH_DASHBOARD_VIEW), c.dashboard);
router.get("/reports", requireAnyPermission(P.BRANCH_REPORTS_VIEW, P.BRANCHES_REPORTS_VIEW), c.reports);
router.route("/targets").get(requireAnyPermission(P.BRANCH_TARGETS_VIEW), c.targets).post(requireAnyPermission(P.BRANCHES_TARGETS_MANAGE), c.targets);
router.put("/targets/:targetId/progress", requireAnyPermission(P.BRANCHES_TARGETS_MANAGE, P.BRANCH_APPROVALS_SUBMIT), c.progress);
router.route("/approvals").get(requireAnyPermission(P.BRANCH_APPROVALS_VIEW, P.BRANCHES_APPROVALS_VIEW), c.approvals).post(requireAnyPermission(P.BRANCH_APPROVALS_SUBMIT), c.submitApproval);
router.put("/approvals/:requestId/review", requireAnyPermission(P.BRANCHES_APPROVALS_MANAGE), c.reviewApproval);
router.route("/operational-requests").get(requireAnyPermission(P.BRANCH_DASHBOARD_VIEW), c.operational).post(requireAnyPermission(P.BRANCH_APPROVALS_SUBMIT), c.operational);
router.get("/audit", requireAnyPermission(P.BRANCHES_APPROVALS_VIEW), c.audit);
router.get("/customers", requireAnyPermission(P.BRANCH_CUSTOMERS_VIEW, P.BRANCH_CUSTOMERS_CREATE), c.customers);
router.post("/customers", requireAnyPermission(P.BRANCH_CUSTOMERS_CREATE), c.createCustomer);
router.get("/customers/:customerId", requireAnyPermission(P.BRANCH_CUSTOMERS_VIEW, P.BRANCH_CUSTOMERS_CREATE), c.customer);
router.get("/transactions", requireAnyPermission(P.BRANCH_FINANCE_VIEW), c.transactions);
router.get("/officers", requireAnyPermission(P.BRANCH_STAFF_VIEW, P.BRANCH_STAFF_MANAGE), c.officers);
router.get("/riders", requireAssignedBranchModule("DELIVERY"), requireAnyPermission(P.BRANCH_DELIVERY_VIEW, P.BRANCH_DELIVERY_MANAGE), c.riders);
router.get("/riders/:riderId", requireAssignedBranchModule("DELIVERY"), requireAnyPermission(P.BRANCH_DELIVERY_VIEW, P.BRANCH_DELIVERY_MANAGE), c.rider);
router.get("/kyc", requireAnyPermission(P.BRANCH_CUSTOMERS_VIEW), c.kyc);
router.get("/solar/applications", requireAssignedBranchModule("SOLAR"), requireAnyPermission(P.BRANCH_SOLAR_VIEW, P.BRANCH_SOLAR_MANAGE), c.solarApplications);
router.post("/solar/applications/:applicationId/assign", requireAssignedBranchModule("SOLAR"), requireAnyPermission(P.BRANCH_SOLAR_MANAGE), c.assignSolarOfficer);
router.get("/phone/applications", requireAssignedBranchModule("PHONE_FINANCING"), requireAnyPermission(P.BRANCH_PHONE_VIEW, P.BRANCH_PHONE_MANAGE), c.phoneApplications);
router.post("/phone/applications/:applicationId/assign", requireAssignedBranchModule("PHONE_FINANCING"), requireAnyPermission(P.BRANCH_PHONE_MANAGE), c.assignPhoneOfficer);
router.get("/marketplace/orders", requireAssignedBranchModule("MARKETPLACE"), requireAnyPermission(P.BRANCH_MARKETPLACE_VIEW, P.BRANCH_MARKETPLACE_MANAGE), c.marketplaceOrders);
router.post("/marketplace/orders/:orderId/assign", requireAssignedBranchModule("MARKETPLACE"), requireAnyPermission(P.BRANCH_MARKETPLACE_MANAGE), c.assignMarketplaceOfficer);
router.post("/kyc/:profileId/assign", requireAnyPermission(P.BRANCH_STAFF_MANAGE), requireAnyPermission(P.BRANCH_KYC_MANAGE), c.assignKycOfficer);
// Delivery handlers already enforce the branch filter from the authenticated
// staff scope. Expose them here with branch permissions so a branch manager
// never needs global DELIVERY_* grants to dispatch work in their branch.
router.get(
  "/deliveries",
  requireAssignedBranchModule("DELIVERY"),
  requireAnyPermission(P.BRANCH_DELIVERY_VIEW, P.BRANCH_DELIVERY_MANAGE),
  getAdminDeliveries
);
router.get(
  "/deliveries/:id/available-riders",
  requireAssignedBranchModule("DELIVERY"),
  requireAnyPermission(P.BRANCH_DELIVERY_MANAGE),
  c.availableRiders
);
router.patch(
  "/deliveries/:id/assign-rider",
  requireAssignedBranchModule("DELIVERY"),
  requireAnyPermission(P.BRANCH_DELIVERY_MANAGE),
  assignRiderToDelivery
);
router.patch(
  "/deliveries/:id/unassign-rider",
  requireAssignedBranchModule("DELIVERY"),
  requireAnyPermission(P.BRANCH_DELIVERY_MANAGE),
  unassignRiderFromDelivery
);
router.patch(
  "/deliveries/:id/reassign-rider",
  requireAssignedBranchModule("DELIVERY"),
  requireAnyPermission(P.BRANCH_DELIVERY_MANAGE),
  reassignRiderToDelivery
);
router.get("/:branchId/members", requireAnyPermission(P.BRANCH_STAFF_VIEW, P.BRANCHES_VIEW), c.members);
router.post("/:branchId/members", requireAnyPermission(P.BRANCH_STAFF_MANAGE, P.BRANCHES_STAFF_MANAGE), c.members);
router.delete("/:branchId/members/:userId", requireAnyPermission(P.BRANCH_STAFF_MANAGE, P.BRANCHES_STAFF_MANAGE), c.removeMember);
router.route("/:branchId/staff").get(requireAnyPermission(P.BRANCH_STAFF_VIEW, P.BRANCH_STAFF_MANAGE), c.staff).post(requireAnyPermission(P.BRANCH_STAFF_MANAGE), c.staff);
router.put("/:branchId/staff/:staffId", requireAnyPermission(P.BRANCH_STAFF_MANAGE), c.updateStaff);
router.put("/:branchId/staff/:staffId/status", requireAnyPermission(P.BRANCH_STAFF_MANAGE), c.staffStatus);
router.post("/:branchId/staff/:staffId/password-reset", requireAnyPermission(P.BRANCH_STAFF_MANAGE), c.staffPasswordReset);
router.post("/:branchId/customers", requireAnyPermission(P.BRANCH_CUSTOMERS_CREATE), c.createCustomer);
router.put("/:branchId/activate", requireAnyPermission(P.BRANCHES_MANAGE), c.activate);
router.put("/:branchId/manager", requireAnyPermission(P.BRANCHES_STAFF_MANAGE), c.assignManager);
router.put("/:branchId/manager/status", requireAnyPermission(P.BRANCHES_STAFF_MANAGE), c.managerStatus);
router.put("/:branchId/manager/password", requireAnyPermission(P.BRANCHES_STAFF_MANAGE), c.managerPassword);
router.put("/:branchId/manager/permissions", requireAnyPermission(P.BRANCHES_STAFF_MANAGE), c.managerPermissions);
router.put("/:branchId/manager/reassign", requireAnyPermission(P.BRANCHES_STAFF_MANAGE), c.assignManager);
router.delete("/:branchId/manager", requireAnyPermission(P.BRANCHES_STAFF_MANAGE), c.removeManager);
router.route("/:branchId").get(requireAnyPermission(P.BRANCHES_VIEW, P.BRANCH_DASHBOARD_VIEW), c.get).put(requireAnyPermission(P.BRANCHES_MANAGE), c.update);
module.exports = router;