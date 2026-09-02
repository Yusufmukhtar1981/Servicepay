const router = require("express").Router();
const { protect } = require("../middleware/auth.middleware");
const { myDriverTrips } = require("../controllers/interstateLogistics.controller");
router.get("/my-trips", protect, myDriverTrips);
module.exports = router;