const express = require("express");
const controller = require("../controllers/announcements.controller");
const { protect, customerOnly } = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requirePermission,
} = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

const router = express.Router();

router.get("/active", protect, customerOnly, controller.getActive);
router.post("/:id/view", protect, customerOnly, controller.view);
router.post("/:id/acknowledge", protect, customerOnly, controller.acknowledge);
router.post("/:id/dismiss", protect, customerOnly, controller.dismiss);
router.post("/:id/click", protect, customerOnly, controller.click);

const staff = (permission) => [protect, loadStaffRole, requirePermission(permission)];
router.get("/admin", ...staff(P.ANNOUNCEMENTS_VIEW), controller.listAdmin);
router.get("/admin/summary", ...staff(P.ANNOUNCEMENTS_SUMMARY), controller.summary);
router.get("/admin/:id", ...staff(P.ANNOUNCEMENTS_VIEW), controller.getAdmin);
router.post("/admin", ...staff(P.ANNOUNCEMENTS_CREATE), controller.create);
router.patch("/admin/:id", ...staff(P.ANNOUNCEMENTS_UPDATE), controller.update);
router.patch("/admin/:id/status", ...staff(P.ANNOUNCEMENTS_ACTIVATE), controller.setStatus);
router.patch("/admin/:id/activate", ...staff(P.ANNOUNCEMENTS_ACTIVATE), controller.setStatus);
router.patch("/admin/:id/deactivate", ...staff(P.ANNOUNCEMENTS_ACTIVATE), controller.setStatus);
router.delete("/admin/:id", ...staff(P.ANNOUNCEMENTS_DELETE), controller.remove);

module.exports = router;