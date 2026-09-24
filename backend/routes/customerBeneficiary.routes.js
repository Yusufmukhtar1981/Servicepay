const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const controller = require("../controllers/customerBeneficiary.controller");

const router = express.Router();
router.use(protect);
router.get("/", controller.list);
router.post("/", controller.create);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);
module.exports = router;