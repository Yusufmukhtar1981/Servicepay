"use strict";
const express = require("express");
const multer = require("multer");
const c = require("../services/expenseManagement.common");
const a = require("../services/expenseRequests.access");
const service = require("../services/expenseRequests.service");
const policies = require("../services/expenseRequests.policies");
const documents = require("../services/expenseManagement.documents");
module.exports = ({ wrap, json, key }) => {
  const router = express.Router();
  const ready = callback => wrap(async (req, res, actor) => {
    a.portal(actor);
    await c.storage.requireReady();
    return callback(req, res, actor);
  });
  router.get("/approval-policies", ready(async (_req, res, actor) => json(res, await policies.list(actor))));
  router.post("/approval-policies", ready(async (req, res, actor) =>
    json(res, await policies.write(null, req.body, actor, key(req)), 201)));
  router.patch("/approval-policies/:id", ready(async (req, res, actor) =>
    json(res, await policies.write(req.params.id, req.body, actor, key(req)))));
  router.get("/requests/references", ready(async (_req, res, actor) => json(res, await service.references(actor))));
  router.get("/requests/notifications", ready(async (_req, res, actor) => json(res, await service.notifications(actor))));
  router.post("/requests/assignments", ready(async (req, res, actor) =>
    json(res, await policies.assignment(req.body, actor, key(req)))));
  router.get("/requests", ready(async (req, res, actor) => json(res, await service.list(req.query, actor))));
  router.post("/requests", ready(async (req, res, actor) => {
    const result = await service.create(req.body, actor, key(req));
    json(res, result, result.idempotent ? 200 : 201);
  }));
  const receive = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: documents.MAX_DOCUMENT_BYTES, files: 1, fields: 5, parts: 6 } }).single("file");
  router.post("/requests/documents", (req, res, next) => {
    try { a.upload(c.context(req)); }
    catch (error) { return res.status(403).json({ success: false, message: error.message }); }
    receive(req, res, error => {
      if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ success: false, message: "Choose one PDF, PNG or JPEG of 8 MiB or less." });
      next();
    });
  }, ready(async (req, res, actor) => json(res,
    await documents.upload(req.file, actor, key(req), { authorize: a.upload }), 201)));
  const download = ready(async (req, res, actor) => {
    const document = await documents.download(req.params.documentId, actor,
      { authorize: (who, row) => a.document(who, row, req.params.id) });
    res.set({ "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${document.filename}"`, "Content-Security-Policy": "sandbox" });
    res.send(document.buffer);
  });
  router.get("/requests/documents/:documentId/download", download);
  router.get("/requests/:id/documents/:documentId/download", download);
  router.get("/requests/:id/audit", ready(async (req, res, actor) =>
    json(res, await service.audit(req.params.id, actor))));
  router.get("/requests/:id", ready(async (req, res, actor) =>
    json(res, { item: await service.publicItem(await service.find(req.params.id, actor), actor) })));
  router.patch("/requests/:id", ready(async (req, res, actor) =>
    json(res, await service.update(req.params.id, req.body, actor, key(req)))));
  router.post("/requests/:id/actions", ready(async (req, res, actor) =>
    json(res, await service.act(req.params.id, req.body, actor, key(req)))));
  return router;
};
