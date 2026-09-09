const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const controller = require("../controllers/adminAssignments.controller");

// Assignment workbench access is deliberately separate from the legacy
// Business Partner routes.  Staff still need the existing assignment grant.
const access = [protect, loadStaffRole, requirePermission(P.BUSINESS_PARTNERS_ASSIGN)];

router.get("/partner/:partnerId", ...access, controller.getPartnerAssignments);
router.get("/catalog", ...access, controller.getCatalog);
router.post("/", ...access, controller.assign);
router.patch("/:assignmentId", ...access, controller.reassign);
router.delete("/:assignmentId", ...access, controller.unassign);

module.exports = router;