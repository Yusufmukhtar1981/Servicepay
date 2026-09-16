const express = require("express");
const edupaySquad = require("../services/edupaySquad.service");
const router = express.Router();
router.post("/", express.raw({ type: ["application/json", "application/*+json"], limit: "256kb" }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.rawBody || "");
    const payload = JSON.parse(raw.toString("utf8"));
    const result = await edupaySquad.handleWebhook({ payload, raw, signature: req.get("x-squad-encrypted-body") || req.get("x-squad-signature"), req });
    return res.json({ success: true, settlement: result });
  } catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
});
module.exports = router;