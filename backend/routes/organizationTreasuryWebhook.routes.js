const express = require("express");
const router = express.Router();
const treasury = require("../services/organizationTreasury.service");
router.post("/squad", async (req, res) => {
  try {
    const raw = req.rawBody;
    const signature = String(req.get("x-squad-encrypted-body") || "");
    if (!raw || !/^[a-f0-9]{128}$/i.test(signature)) return res.status(401).json({ success: false, message: "Invalid webhook signature." });
    const crypto = require("crypto"); const secret = String(process.env.ORG_SQUAD_WEBHOOK_SECRET || process.env.SQUAD_WEBHOOK_SECRET || "").trim();
    if (!secret) return res.status(503).json({ success: false, message: "Webhook configuration required." });
    const expected = crypto.createHmac("sha512", secret).update(raw).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) return res.status(401).json({ success: false, message: "Invalid webhook signature." });
    return res.json({ success: true, data: await treasury.handleWebhook(req.body, signature, raw) });
  } catch (e) { return res.status(e.status || 500).json({ success: false, message: e.message }); }
});
module.exports = router;