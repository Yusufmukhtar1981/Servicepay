"use strict";
const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
const axios = require("axios");
const c = require("./expenseManagement.common");
const provider = require("./amanaDocument.service");
const originalEvidence = require("./expenseManagement.documentProvider");
const { Document, r } = c;
const sha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
function validate(file) {
  try { provider.validateFile(file); }
  catch { throw r.fail("Expense evidence must be a valid PDF, JPEG or PNG of 8 MiB or less.", 400, "EXPENSE_DOCUMENT_INVALID"); }
}
async function upload(file, actor, key, dependencies = {}) {
  if (dependencies.authorize) await dependencies.authorize(actor);
  else {
    c.allow(actor, r.PERMISSIONS.create);
    c.allow(actor, r.PERMISSIONS.documents);
  }
  validate(file);
  file = { ...file, mimetype: String(file.mimetype).toLowerCase() };
  const uploadRequestKey = r.requestKey(key, actor.id), checksum = sha256(file.buffer);
  const name = r.text(path.basename(String(file.originalname || "expense-evidence").replaceAll("\\", "/")),
    "Document name", 180);
  const initial = await c.atomic(async session => {
    const existing = await Document.findOne({ uploadRequestKey }).session(session).lean();
    if (existing) {
      if (existing.sha256 !== checksum || existing.mimeType !== file.mimetype ||
          existing.size !== file.buffer.length || existing.name !== name) {
        throw r.fail("This upload key was already used for a different document.", 409);
      }
      return { row: existing, started: false };
    }
    const id = new mongoose.Types.ObjectId();
    const record = { _id: id, uploadedBy: actor.id, name, mimeType: file.mimetype,
      size: file.buffer.length, sha256: checksum,
      storageKey: `servicepay/company-expenses/document-${id}`,
      state: "UPLOADING", uploadRequestKey };
    await Document.create([record], { session });
    await c.append({ subjectType: "DOCUMENT", subjectId: id, action: "EXPENSE_DOCUMENT_UPLOAD_STARTED",
      actor, reason: "Private supporting evidence upload started.", before: null, after: c.documentMetadata(record) }, session);
    return { row: record, started: true };
  });
  const { row } = initial;
  if (!initial.started) {
    if (["READY", "ATTACHED"].includes(row.state)) return { document: c.documentMetadata(row), idempotent: true };
    throw r.fail("The previous upload is unconfirmed. Do not repeatedly resend it; use another verified document or request review.",
      409, "EXPENSE_DOCUMENT_UNCONFIRMED");
  }
  try {
    const stored = await (dependencies.uploadOne || originalEvidence.uploadOne)(file, "servicepay/company-expenses", {
      publicId: row.storageKey, uploadedBy: actor.id, requestReference: String(row._id),
    });
    if (stored.assetId !== row.storageKey) throw new Error("EXPENSE_STORAGE_IDENTIFIER_MISMATCH");
    await c.atomic(async session => {
      const result = await Document.updateOne({ _id: row._id, state: "UPLOADING" },
        { $set: { state: "READY" } }, { session });
      if (result.matchedCount !== 1) throw r.fail("The upload confirmation changed concurrently.", 409);
      await c.append({ subjectType: "DOCUMENT", subjectId: row._id, action: "EXPENSE_DOCUMENT_UPLOAD_CONFIRMED",
        actor, reason: "Private provider upload confirmed the exact assigned asset identifier.",
        before: c.documentMetadata(row), after: { ...c.documentMetadata(row), state: "READY" } }, session);
    });
  } catch {
    // An uncertain provider upload is retained for review, never blindly replayed
    // or deleted: it may already be linked by a concurrent successful request.
    await c.atomic(async session => {
      const changed = await Document.updateOne({ _id: row._id, state: "UPLOADING" },
        { $set: { state: "UNCONFIRMED", errorCategory: "UPLOAD_NOT_CONFIRMED" } }, { session });
      if (changed.matchedCount) await c.append({
        subjectType: "DOCUMENT", subjectId: row._id, action: "EXPENSE_DOCUMENT_UPLOAD_UNCONFIRMED",
        actor, reason: "Upload outcome requires review; no public URL was issued or existing asset deleted.",
        before: c.documentMetadata(row), after: { ...c.documentMetadata(row), state: "UNCONFIRMED" },
      }, session);
    }).catch(() => {});
    throw r.fail("Private document upload could not be confirmed. No expense or payment was created.",
      503, "EXPENSE_DOCUMENT_UPLOAD_UNCONFIRMED");
  }
  return { document: { ...c.documentMetadata(row), state: "READY" }, idempotent: false };
}
async function providerBytes(row) {
  const url = provider.buildSignedUrl({
    assetId: row.storageKey, resourceType: "raw",
    format: row.mimeType === "application/pdf" ? "pdf" : row.mimeType === "image/png" ? "png" : "jpg",
  });
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000,
    maxContentLength: provider.MAX_DOCUMENT_BYTES, maxBodyLength: provider.MAX_DOCUMENT_BYTES,
    maxRedirects: 0 });
  return Buffer.from(response.data);
}
async function download(id, actor, dependencies = {}) {
  if (!dependencies.authorize) {
    c.allow(actor, r.PERMISSIONS.view);
    c.allow(actor, r.PERMISSIONS.documents);
  }
  await c.storage.requireReady();
  const row = await Document.findById(r.id(id, "Document ID")).lean();
  if (!row || !["READY", "ATTACHED"].includes(row.state) ||
      (!row.expenseId && String(row.uploadedBy) !== actor.id)) throw r.fail("Document was not found.", 404);
  if (dependencies.authorize) await dependencies.authorize(actor, row);
  let buffer;
  try { buffer = await (dependencies.providerBytes || providerBytes)(row); }
  catch { throw r.fail("Private expense evidence is temporarily unavailable.", 503, "EXPENSE_DOCUMENT_DOWNLOAD_FAILED"); }
  validate({ buffer, mimetype: row.mimeType });
  if (buffer.length !== row.size || sha256(buffer) !== row.sha256) {
    throw r.fail("Document integrity verification failed. No file was delivered.", 502, "EXPENSE_DOCUMENT_INTEGRITY_FAILED");
  }
  await c.append({ subjectType: "DOCUMENT", subjectId: row._id, action: "EXPENSE_DOCUMENT_DOWNLOADED",
    actor, reason: "Authorized private evidence download; original bytes verified.",
    before: null, after: { documentId: String(row._id), expenseId: row.expenseId ? String(row.expenseId) : null } });
  return { buffer, mimeType: row.mimeType,
    filename: `ServicePay-Expense-Evidence-${row._id}.${row.mimeType === "application/pdf" ? "pdf" : row.mimeType === "image/png" ? "png" : "jpg"}` };
}
module.exports = { upload, download, validate, providerBytes, MAX_DOCUMENT_BYTES: provider.MAX_DOCUMENT_BYTES };
