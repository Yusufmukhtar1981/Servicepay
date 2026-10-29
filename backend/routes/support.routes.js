const express = require("express");
const { protect, customerOnly } = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requirePermission,
} = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
const controller = require("../controllers/support.controller");
const smart = require("../controllers/smartSupport.controller");

const customer = express.Router();
customer.use(protect, customerOnly);
customer.route("/tickets").post(controller.createTicket).get(controller.listCustomerTickets);
customer.get("/tickets/:id", controller.getCustomerTicket);
customer.post("/tickets/:id/replies", controller.customerReply);

const admin = express.Router();
admin.use(protect, loadStaffRole);
admin.route("/ai-settings")
  .get(requirePermission(P.SUPPORT_VIEW), smart.getSettings)
  .put(requirePermission(P.SUPPORT_RESOLVE), smart.updateSettings);
admin.get("/ai-metrics", requirePermission(P.SUPPORT_VIEW), smart.metrics);
admin.route("/ai-knowledge")
  .get(requirePermission(P.SUPPORT_VIEW), smart.getKnowledge)
  .put(requirePermission(P.SUPPORT_RESOLVE), smart.updateKnowledge);
admin.get("/ai-conversations", requirePermission(P.SUPPORT_VIEW), smart.conversations);
admin.get("/ai-conversations/:id", requirePermission(P.SUPPORT_VIEW), smart.conversation);
admin.get("/metrics", requirePermission(P.SUPPORT_VIEW), controller.metrics);
admin.get("/staff", requirePermission(P.SUPPORT_ASSIGN), controller.staff);
admin.route("/tickets").get(requirePermission(P.SUPPORT_VIEW), controller.listAdminTickets);
admin
  .route("/tickets/:id")
  .get(requirePermission(P.SUPPORT_VIEW), controller.getAdminTicket)
  .patch(requirePermission(P.SUPPORT_RESOLVE), controller.updateTicket);
admin.post(
  "/tickets/:id/replies",
  requirePermission(P.SUPPORT_RESOLVE),
  controller.adminReply,
);
admin.post(
  "/tickets/:id/notes",
  requirePermission(P.SUPPORT_RESOLVE),
  controller.addNote,
);

module.exports = { customer, admin };