"use strict";
const receipt = require("../services/airtimeReceipt.service");
const handle = fn => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (res.headersSent) return res.end();
    res.status(error.status || 500).json({ success: false,
      message: error.status ? error.message : "Airtime details or receipt are temporarily unavailable." });
  }
};
exports.details = handle(async (req, res) => {
  const { view } = await receipt.load(req.user?._id || req.user?.id, req.params.reference);
  res.set("Cache-Control", "private, no-store").json({ success: true, data: { transaction: view } });
});
exports.download = handle(async (req, res) => {
  const { raw, view } = await receipt.load(req.user?._id || req.user?.id, req.params.reference);
  receipt.assertReceiptable(raw);
  if (view.refundRecorded) return res.status(409).json({ success: false, message: "This transaction was refunded." });
  // Build before writing response headers, so missing assets fail explicitly.
  const doc = receipt.pdf(view);
  const filename = "ServicePay-Airtime-" + String(view.reference).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) + ".pdf";
  res.set("Cache-Control", "private, no-store").type("application/pdf").attachment(filename);
  doc.on("error", () => { if (!res.headersSent) res.status(500); res.end(); });
  doc.pipe(res); doc.end();
});
