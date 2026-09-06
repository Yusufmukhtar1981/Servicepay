const express = require("express");
const router = express.Router();

const { verifyId } = require("../controllers/idVerification.controller");
const { protect } = require("../middleware/auth.middleware");

router.post("/verify", protect, verifyId);

module.exports = router;