const express = require("express");
const { protect, customerOnly, adminOnly } = require("../middleware/auth.middleware");
const controller = require("../controllers/support.controller");

const customer = express.Router();
customer.use(protect, customerOnly);
customer.route("/tickets").post(controller.createTicket).get(controller.listCustomerTickets);
customer.get("/tickets/:id", controller.getCustomerTicket);
customer.post("/tickets/:id/replies", controller.customerReply);

const admin = express.Router();
admin.use(protect, adminOnly("HEAD_OFFICE"));
admin.get("/metrics", controller.metrics);
admin.get("/staff", controller.staff);
admin.route("/tickets").get(controller.listAdminTickets);
admin.route("/tickets/:id").get(controller.getAdminTicket).patch(controller.updateTicket);
admin.post("/tickets/:id/replies", controller.adminReply);
admin.post("/tickets/:id/notes", controller.addNote);

module.exports = { customer, admin };