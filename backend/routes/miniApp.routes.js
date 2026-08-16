const express = require("express");

const {
  getMiniApps,
  getMiniApp,
} = require("../controllers/miniApp.controller");

const router = express.Router();

/*
 * ServicePay Mini Apps V1
 * Public catalogue.
 * No financial transaction happens on these routes.
 */
router.get("/", getMiniApps);
router.get("/:slug", getMiniApp);

module.exports = router;
