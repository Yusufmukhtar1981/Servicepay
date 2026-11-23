"use strict";
const express = require("express");
const multer = require("multer");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const c = require("../services/expenseManagement.common");
const service = require("../services/expenseManagement.service");
const catalog = require("../services/expenseManagement.catalog");
const documents = require("../services/expenseManagement.documents");
const reports = require("../services/expenseManagement.reports");
const legacy = require("../services/expenseManagement.legacy");
const router = express.Router();
const wrap = callback => async (req, res) => {
  try { await callback(req, res, c.context(req)); }
  catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const status = error.statusCode || (error.name === "ValidationError" ? 400 : 503);
    res.status(status).json({ success: false,
      message: error.statusCode ? error.message : "The expense operation is unavailable. No bank or customer wallet action was performed.",
      code: error.statusCode ? error.code || "EXPENSE_REQUEST_REJECTED" : "EXPENSE_OPERATION_UNAVAILABLE" });
  }
};
const json = (res, data, status = 200) => res.status(status).json({ success: true, data });
const key = req => req.get("Idempotency-Key");
function financeAccess(req, res, next) {
  try { c.allow(c.context(req), c.r.PERMISSIONS.view); next(); }
  catch (error) { res.status(error.statusCode || 403).json({ success: false, message: error.message }); }
}
router.use(protect, loadStaffRole);
router.use((_req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  next();
});
router.use(financeAccess);
router.get("/readiness", wrap(async (_req, res, actor) => {
  const ready = await c.storage.readiness();
  const policy = ready.ready
    ? await c.Registry.findOne({ kind: "POLICY", key: "APPROVAL", active: true }).lean() : null;
  json(res, { ...ready, permissions: actor.permissions, actor: { id: actor.id, role: actor.role },
    workflowConfigured: !!policy?.approvalSteps?.length,
    limits: { maxDocumentBytes: documents.MAX_DOCUMENT_BYTES, maxDocuments: 10 } });
}));
router.get("/references", wrap(async (_req, res, actor) => json(res, await catalog.references(actor))));
router.get("/policy", wrap(async (_req, res, actor) => json(res, await catalog.policy(actor))));
router.put("/policy", wrap(async (req, res, actor) => json(res,
  await catalog.write("POLICY", null, req.body, actor, key(req)))));
for (const [name, kind] of [["categories", "CATEGORY"], ["vendors", "VENDOR"]]) {
  router.get(`/${name}`, wrap(async (_req, res, actor) => json(res, await catalog.list(kind, actor))));
  router.post(`/${name}`, wrap(async (req, res, actor) => json(res,
    await catalog.write(kind, null, req.body, actor, key(req)), 201)));
  router.patch(`/${name}/:id`, wrap(async (req, res, actor) => json(res,
    await catalog.write(kind, req.params.id, req.body, actor, key(req)))));
}
router.get("/summary", wrap(async (req, res, actor) => json(res, await reports.summary(req.query, actor))));
router.get("/legacy-expenses", wrap(async (req, res, actor) => json(res, await legacy.list(req.query, actor))));
router.get("/legacy-expenses/:id/document", wrap(async (req, res, actor) => {
  const document = await legacy.document(req.params.id, actor);
  res.set({ "Content-Type": document.mimeType,
    "Content-Disposition": `attachment; filename="${document.filename}"`, "Content-Security-Policy": "sandbox" });
  res.send(document.buffer);
}));
router.get("/audit", wrap(async (req, res, actor) => json(res, await reports.audit(req.query, actor))));
router.get("/reports", wrap(async (req, res, actor) => {
  const report = await reports.exportReport(req.query, actor);
  res.set({ "Content-Type": report.mimeType,
    "Content-Disposition": `attachment; filename="${report.filename}"`, "Content-Security-Policy": "sandbox" });
  res.send(report.buffer);
}));
router.get("/expenses", wrap(async (req, res, actor) => json(res, await service.list(req.query, actor))));
router.post("/expenses", wrap(async (req, res, actor) => {
  const result = await service.create(req.body, actor, key(req));
  json(res, result, result.idempotent ? 200 : 201);
}));
router.get("/expenses/:id", wrap(async (req, res, actor) => json(res, await service.get(req.params.id, actor))));
router.patch("/expenses/:id", wrap(async (req, res, actor) => json(res,
  await service.update(req.params.id, req.body, actor, key(req)))));
router.post("/expenses/:id/actions", wrap(async (req, res, actor) => json(res,
  await service.act(req.params.id, req.body, actor, key(req)))));
router.get("/expenses/:id/audit", wrap(async (req, res, actor) => json(res,
  await reports.audit(req.query, actor, req.params.id))));

const receive = multer({ storage: multer.memoryStorage(),
  limits: { fileSize: documents.MAX_DOCUMENT_BYTES, files: 1, fields: 5, parts: 6 } }).single("file");
router.post("/documents", (req, res, next) => {
  try {
    const actor = c.context(req);
    c.allow(actor, c.r.PERMISSIONS.create);
    c.allow(actor, c.r.PERMISSIONS.documents);
  } catch (error) { return res.status(403).json({ success: false, message: error.message }); }
  receive(req, res, error => {
    if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false, message: "Choose one PDF, PNG or JPEG file of 8 MiB or less.",
    });
    next();
  });
}, wrap(async (req, res, actor) => json(res, await documents.upload(req.file, actor, key(req)), 201)));
router.get("/documents/:id/download", wrap(async (req, res, actor) => {
  const document = await documents.download(req.params.id, actor);
  res.set({ "Content-Type": document.mimeType,
    "Content-Disposition": `attachment; filename="${document.filename}"`, "Content-Security-Policy": "sandbox" });
  res.send(document.buffer);
}));
module.exports = router;
module.exports.financeAccess = financeAccess;
