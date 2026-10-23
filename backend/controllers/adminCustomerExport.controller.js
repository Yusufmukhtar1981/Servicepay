"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { MIME, writeExport } = require("../services/customerExport.service");

const PROJECTION = "_id fullName phone email";
const active = new Set();
const reject = (status, message) => Object.assign(new Error(message), { status });
const validId = (v) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
const escapeRegex = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scopeFilter(req) {
  const scope = req.staffAccess?.scope;
  if (!scope) throw reject(403, "Customer export scope is unavailable.");
  switch (String(scope.type).toUpperCase()) {
    case "GLOBAL": return {};
    case "ZONE":
      if (typeof scope.zone === "string" && scope.zone.trim()) return { zone: scope.zone };
      break;
    case "STATE":
      if (typeof scope.zone === "string" && scope.zone.trim() &&
          typeof scope.state === "string" && scope.state.trim()) return { zone: scope.zone, state: scope.state };
      break;
    case "BRANCH":
      if (validId(String(scope.branchId))) return { branchId: scope.branchId };
      break;
    case "SELF":
      if (validId(String(scope.userId))) return { _id: scope.userId };
      break;
    default: break;
  }
  // Never widen unsupported/custom/partially configured scopes to GLOBAL.
  throw reject(403, "Your customer export scope is not supported or is incomplete.");
}
function baseFilter(req, query = "") {
  if (typeof query !== "string" || query.length > 200) throw reject(400, "Search must be at most 200 characters.");
  const parts = [{ role: "CUSTOMER", isDeleted: { $ne: true } }, scopeFilter(req)];
  const q = query.trim();
  if (q) parts.push({ $or: ["fullName", "phone", "email"].map((field) =>
    ({ [field]: { $regex: escapeRegex(q), $options: "i" } })) });
  return { $and: parts };
}
function downloadFilter(req) {
  const { scope, query = "", ids, format, action } = req.body || {};
  if (!Object.hasOwn(MIME, format)) throw reject(400, "Select CSV, Excel or PDF.");
  if (!["download", "share", "print"].includes(action)) throw reject(400, "Invalid export action.");
  if (action === "print" && format !== "pdf") throw reject(400, "Printing requires PDF format.");
  if (!["all", "filtered", "selected"].includes(scope)) throw reject(400, "Invalid customer selection.");
  const filter = baseFilter(req, scope === "filtered" ? query : "");
  if (scope === "selected") {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || !ids.every(validId)) {
      throw reject(400, "Select between 1 and 10,000 valid customer IDs.");
    }
    filter.$and.push({ _id: { $in: [...new Set(ids)] } });
  }
  return filter;
}
async function listCustomers(req, res) {
  res.set("Cache-Control", "private, no-store");
  try {
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw reject(400, "Page size must be 1–100.");
    const filter = baseFilter(req, req.query.q || "");
    if (req.query.after) {
      if (!validId(req.query.after)) throw reject(400, "Invalid page cursor.");
      filter.$and.push({ _id: { $gt: req.query.after } });
    }
    const rows = await User.find(filter).select(PROJECTION).sort({ _id: 1 })
      .limit(limit + 1).maxTimeMS(15000).lean();
    const more = rows.length > limit;
    const customers = rows.slice(0, limit).map((row) => ({
      id: String(row._id), fullName: row.fullName || "", phone: row.phone || "", email: row.email || "",
    }));
    return res.json({ success: true, customers, nextCursor: more ? customers.at(-1).id : null });
  } catch (error) {
    return res.status(error.status || 503).json({ success: false,
      message: error.status ? error.message : "Customer list is temporarily unavailable." });
  }
}
async function audit(req, metadata, status = "SUCCESSFUL") {
  return AdminAuditLog.create({
    actorId: req.user._id || req.user.id, actorRole: req.user.role,
    action: "DATA_EXPORT_CREATED", reason: "Customer contact export",
    // Audit metadata intentionally excludes contact values, search text and IDs.
    metadata: { dataset: "CUSTOMER_CONTACTS", ...metadata }, status,
    requestMethod: req.method, requestPath: req.baseUrl + req.path,
  });
}
async function download(req, res) {
  res.set({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" });
  let directory;
  let ownsSlot = false;
  const key = String(req.user?._id || req.user?.id || "");
  const aborter = new AbortController();
  const onClose = () => { if (!res.writableFinished) aborter.abort(); };
  res.on("close", onClose);
  try {
    const filter = downloadFilter(req);
    if (active.has(key) || active.size >= 2) throw reject(429, "Another customer export is running. Please try again shortly.");
    active.add(key);
    ownsSlot = true;
    const { scope, format, action, ids } = req.body;
    if (scope === "selected") {
      const count = await User.countDocuments(filter).maxTimeMS(15000);
      if (count !== new Set(ids).size) throw reject(403, "One or more selected customers are unavailable or outside your scope.");
    }
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "servicepay-customer-export-"));
    await fs.chmod(directory, 0o700);
    const filename = `Servicepay-Customers.${format}`;
    const destination = path.join(directory, filename);
    const cursor = User.find(filter).select(PROJECTION).sort({ _id: 1 })
      .maxTimeMS(120000).lean().cursor({ batchSize: 250 });
    let count;
    try { count = await writeExport(destination, format, cursor, aborter.signal); }
    finally { await cursor.close(); }
    if (aborter.signal.aborted) throw reject(499, "Export cancelled.");
    // Fail closed: no personal-data file leaves the server if audit persistence fails.
    await audit(req, { scope, format, action, rowCount: count });
    res.type(MIME[format]);
    await new Promise((resolve, rejectDownload) => {
      res.download(destination, filename, (error) => error ? rejectDownload(error) : resolve());
    });
  } catch (error) {
    if (ownsSlot) await audit(req, {
      scope: req.body?.scope, format: req.body?.format, action: req.body?.action,
      failureCategory: error.status ? "REQUEST_REJECTED" : "EXPORT_UNAVAILABLE",
    }, "FAILED").catch(() => {});
    if (!res.headersSent && !res.destroyed) res.status(error.status === 499 ? 400 : error.status || 503)
      .json({ success: false, message: error.status ? error.message : "Unable to generate customer export. Please try again." });
    else if (!res.destroyed) res.destroy();
  } finally {
    res.off("close", onClose);
    if (ownsSlot) active.delete(key);
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
module.exports = { scopeFilter, baseFilter, downloadFilter, listCustomers, download };
