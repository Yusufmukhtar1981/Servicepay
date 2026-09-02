const router = require("express").Router();
const c = require("../controllers/interstateLogistics.controller");
const { protect, adminOnly } = require("../middleware/auth.middleware");
router.use(protect, adminOnly("HEAD_OFFICE"));
router.get("/", c.adminRoutes);
router.post("/", c.createRoute);
router.patch("/:id", c.updateRoute);
module.exports = router;