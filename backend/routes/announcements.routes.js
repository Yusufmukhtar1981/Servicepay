const express = require("express");
const controller = require("../controllers/announcements.controller");
const { protect, customerOnly } = require("../middleware/auth.middleware");
const {
  loadStaffRole,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");

const router = express.Router();

router.get("/active", protect, customerOnly, controller.getActive);
router.get("/:id/progress", protect, customerOnly, controller.progress);
router.post("/:id/view", protect, customerOnly, controller.view);
router.post("/:id/acknowledge", protect, customerOnly, controller.acknowledge);
router.post("/:id/dismiss", protect, customerOnly, controller.dismiss);
router.post("/:id/click", protect, customerOnly, controller.click);

const staff = (permission) => [protect, loadStaffRole, requirePermission(permission)];
const staffAny = (...permissions) => [protect, loadStaffRole, requireAnyPermission(permissions)];
const headOfficePromo = (permission) => [
  protect,
  loadStaffRole,
  (req, res, next) => {
    if (!req.staffAccess?.isHeadOffice) {
      return res.status(403).json({ success: false, message: "Head Office access is required." });
    }
    return next();
  },
  requirePermission(permission),
];
router.get("/admin", ...staff(P.ANNOUNCEMENTS_VIEW), controller.listAdmin);
router.get("/admin/summary", ...staff(P.ANNOUNCEMENTS_SUMMARY), controller.summary);
router.get("/admin/promo-leaderboard", ...headOfficePromo(P.ANNOUNCEMENTS_PARTICIPANTS_VIEW), controller.promoLeaderboard);
router.get("/admin/promo-leaderboard/:customerId", ...headOfficePromo(P.ANNOUNCEMENTS_PARTICIPANTS_VIEW), controller.promoLeaderboardDetail);
router.get("/admin/:id/participants", ...staff(P.ANNOUNCEMENTS_PARTICIPANTS_VIEW), controller.participants);
router.get("/admin/:id/participants/winners", ...staffAny(P.ANNOUNCEMENTS_PARTICIPANTS_HISTORY_VIEW, P.ANNOUNCEMENTS_WINNERS_VIEW), controller.winners);
router.get("/admin/:id/winners", ...staffAny(P.ANNOUNCEMENTS_PARTICIPANTS_HISTORY_VIEW, P.ANNOUNCEMENTS_WINNERS_VIEW), controller.winners);
router.get("/admin/:id/winners/history", ...staffAny(P.ANNOUNCEMENTS_PARTICIPANTS_HISTORY_VIEW, P.ANNOUNCEMENTS_WINNERS_VIEW), controller.winners);
router.post("/admin/:id/participants/:customerId/winner", ...staff(P.ANNOUNCEMENTS_WINNER_MARK), controller.markWinner);
router.get("/admin/:id", ...staff(P.ANNOUNCEMENTS_VIEW), controller.getAdmin);
router.post("/admin", ...staff(P.ANNOUNCEMENTS_CREATE), controller.create);
router.patch("/admin/:id", ...staff(P.ANNOUNCEMENTS_UPDATE), controller.update);
router.patch("/admin/:id/status", ...staff(P.ANNOUNCEMENTS_ACTIVATE), controller.setStatus);
router.patch("/admin/:id/activate", ...staff(P.ANNOUNCEMENTS_ACTIVATE), controller.setStatus);
router.patch("/admin/:id/deactivate", ...staff(P.ANNOUNCEMENTS_ACTIVATE), controller.setStatus);
router.delete("/admin/:id", ...staff(P.ANNOUNCEMENTS_DELETE), controller.remove);

module.exports = router;