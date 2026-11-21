const router = require("express").Router();
const controller = require("../controllers/operationsVirtualAccountJobs.controller");
router.get("/summary", controller.summary);
router.get("/jobs", controller.list);
router.post("/jobs", controller.create);
router.get("/jobs/:id", controller.detail);
router.post("/jobs/:id/retry", controller.retry);
router.get("/jobs/:id/report", controller.report);
module.exports = router;
