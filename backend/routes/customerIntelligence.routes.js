"use strict";
const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission, requireAnyPermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const controller = require("../controllers/customerIntelligence.controller");
const reportingAccess = (req, res, next) => {
  if (req.staffAccess?.permissions?.includes(P.MARKETING_CUSTOMER_INTELLIGENCE_VIEW)) return next();
  return requirePermission(P.USERS_VIEW)(req, res, () => requirePermission(P.TRANSACTIONS_VIEW)(req, res, next));
};
const exportAccess = requireAnyPermission(P.CUSTOMERS_EXPORT, P.MARKETING_CUSTOMER_INTELLIGENCE_EXPORT);
router.use(protect, loadStaffRole, reportingAccess);
router.get("/customers", controller.customers);
router.get("/customers/:id", controller.profile);
router.get("/performance", controller.performance);
router.put("/settings", requirePermission(P.SETTINGS_UPDATE), controller.updateSettings);
router.post("/export", exportAccess, controller.export);
router.post("/campaign-preview", exportAccess, requirePermission(P.MARKETING_CAMPAIGNS_MANAGE), controller.campaignPreview);
module.exports = router;
