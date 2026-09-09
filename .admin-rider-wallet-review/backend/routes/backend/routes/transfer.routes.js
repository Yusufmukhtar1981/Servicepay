const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth.middleware");
const transferController = require("../controllers/transfer.controller");

router.post("/servicepay", protect, transferController.transfer);

module.exports = router;