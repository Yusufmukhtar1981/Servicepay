const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const controller = require("../controllers/zonalOversight.controller");

const router = express.Router();
router.use(protect);
router.use((req, res, next) => {
  if (!req.user || String(req.user.role || "").toUpperCase() !== "ZONAL_MANAGER") {
    return res.status(403).json({ success: false, message: "Zonal manager access required." });
  }
  return next();
});
router.get("/overview", controller.getOverview);
router.get("/:section", controller.list);
router.get("/:section/:id", controller.getOne);

module.exports = router;