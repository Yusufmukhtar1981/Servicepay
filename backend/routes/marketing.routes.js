"use strict";
const express = require("express");
const multer = require("multer");
const crypto = require("node:crypto");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const service = require("../services/marketing.service");
const { overview } = require("../services/marketingAnalytics.service");
const { Record, STATUSES, FIELDS, CHANNELS, fail, id, requireGrant } = service;
const User = require("../models/user.model");
const Role = require("../models/role.model");
const staff = require("../controllers/staffManagement.controller");
const media = require("../services/marketingMedia.service");
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.use(protect, loadStaffRole);
router.use(wrap(async (req, res, next) => {
  requireGrant(req.staffAccess, "marketing.view");
  // Fail explicitly, never create collections or indexes during first use.
  if (!await service.ready()) throw fail("Marketing storage is not provisioned. No data was changed.", 503);
  next();
}));
router.get("/schema", (req, res) => ok(res, {
  kinds: Object.keys(STATUSES), fields: FIELDS, statuses: STATUSES, channels: CHANNELS,
  headOffice: req.staffAccess.isHeadOffice === true,
  permissions: req.staffAccess.isHeadOffice
    ? ["marketing.view", ...new Set([...Object.values(service.PERMISSIONS),
      "marketing.budgets.approve", "marketing.content.approve", "marketing.export", "marketing.audit"])]
    : req.staffAccess.permissions.filter(p => p.startsWith("marketing.")),
}));
router.get("/overview", wrap(async (req, res) => ok(res, await overview(req.query))));

function filter(req, kind) {
  if (!STATUSES[kind] && !["activity", "asset"].includes(kind)) throw fail("Unknown marketing module.", 404);
  if (kind === "activity") requireGrant(req.staffAccess, "marketing.audit");
  const result = { kind };
  for (const key of ["campaignId", "officerId"]) if (req.query[key]) result[key] = id(req.query[key]);
  if (req.query.status) {
    if (!STATUSES[kind]?.includes(req.query.status)) throw fail("Invalid status filter.");
    result.status = req.query.status;
  }
  if (req.query.search) {
    if (typeof req.query.search !== "string" || req.query.search.length > 100) throw fail("Search must be at most 100 characters.");
    result.title = { $regex: req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }
  if (req.query.preset) result.createdAt = service.range(req.query);
  return result;
}
router.get("/records/:kind", wrap(async (req, res) => {
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  const match = filter(req, req.params.kind);
  const [items, total] = await Promise.all([
    Record.find(match).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Record.countDocuments(match),
  ]);
  ok(res, { items, total, page, limit });
}));
router.post("/records/:kind", wrap(async (req, res) => ok(res, await service.create(req), 201)));
router.patch("/records/:kind/:id", wrap(async (req, res) => ok(res, await service.update(req))));
router.post("/records/:kind/:id/transition", wrap(async (req, res) => ok(res, await service.update(req, true))));

// Existing staff APIs retain ownership of hashing, temporary passwords, session
// revocation, hierarchy and audit. This adapter only narrows their target set.
router.get("/team", wrap(async (req, res) => {
  const [items, roles] = await Promise.all([
    User.find({ role: "STAFF", isStaff: true, department: "MARKETING" })
      .select("_id fullName email phone status staffId department mustChangePassword lastStaffLoginAt staffRoleId")
      .populate("staffRoleId", "name displayName permissions status hierarchyLevel")
      .limit(500).lean(),
    Role.find({ department: "MARKETING", status: "ACTIVE" })
      .select("_id name displayName permissions department hierarchyLevel").lean(),
  ]);
  ok(res, { items, roles });
}));
router.use("/team", (req, res, next) => {
  if (req.method === "GET") return next();
  try { requireGrant(req.staffAccess, "marketing.team.manage"); next(); } catch (e) { next(e); }
});
router.post("/team", wrap(async (req, res) => {
  const role = await Role.findOne({ _id: id(req.body.roleId), department: "MARKETING", status: "ACTIVE" }).lean();
  if (!role) throw fail("An active marketing role is required.");
  if (!req.staffAccess.isHeadOffice && role.name !== "MARKETING_OFFICER") throw fail("Only Head Office can appoint a Head of Marketing.", 403);
  if ((role.permissions || []).some(p => !p.startsWith("marketing."))) throw fail("Marketing staff roles cannot grant non-marketing powers.", 403);
  // Head of Marketing may create an officer only with powers they already have.
  return staff.createStaff(req, res);
}));
async function teamTarget(req, res, next) {
  try {
    const target = await User.findOne({
      _id: id(req.params.staffId), role: "STAFF", isStaff: true, department: "MARKETING",
    }).populate("staffRoleId").lean();
    if (!target) throw fail("Marketing staff not found.", 404);
    if (!req.staffAccess.isHeadOffice && target.staffRoleId?.name !== "MARKETING_OFFICER") throw fail("Only Head Office can manage marketing leaders.", 403);
    next();
  } catch (e) { next(e); }
}
router.patch("/team/:staffId", teamTarget, wrap(async (req, res) => {
  if (Object.keys(req.body).some(k => !["fullName", "phone", "email"].includes(k))) throw fail("Use Head Office staff administration to change roles or access.");
  return staff.updateStaff(req, res);
}));
router.post("/team/:staffId/status", teamTarget, wrap(staff.updateStaffStatus));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } });
function mime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.subarray(0,4).toString() === "RIFF" && buffer.subarray(8,12).toString() === "WEBP") return "image/webp";
  if (buffer.subarray(0,5).toString() === "%PDF-") return "application/pdf";
  if (buffer.subarray(4,8).toString() === "ftyp") return "video/mp4";
  throw fail("Only PNG, JPEG, WEBP, PDF or MP4 uploads are supported.");
}
router.post("/assets", (req, res, next) => {
  try { requireGrant(req.staffAccess, "marketing.content.manage"); next(); } catch (e) { next(e); }
}, upload.single("file"), wrap(async (req, res) => {
  if (!req.file?.buffer?.length) throw fail("Select a file.");
  const type = mime(req.file.buffer);
  const filename = req.file.originalname.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "marketing-asset";
  const key = req.headers["idempotency-key"];
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key || "")) throw fail("A unique Idempotency-Key is required.");
  const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const prior = await Record.findOne({ createdBy: req.user._id, requestKey: key }).lean();
  if (prior) {
    if (prior.kind !== "asset" || prior.data.sha256 !== sha256) throw fail("Idempotency key conflicts with another upload.", 409);
    return ok(res, prior, 200);
  }
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "application/pdf": "pdf", "video/mp4": "mp4" }[type];
  const identity = crypto.createHash("sha256").update(`${req.user._id}:${key}:${sha256}`).digest("hex");
  // The upload is outside retryable Mongo transactions. A retry uses the same
  // immutable object identity, never overwrites an existing material.
  const storage = await media.store(req.file.buffer, `servicepay-marketing/${identity}.${extension}`);
  const record = await service.mutate(req, async session => {
    const existing = await Record.findOne({ createdBy: req.user._id, requestKey: key }).session(session);
    if (existing) {
      if (existing.kind !== "asset" || existing.data.sha256 !== sha256) throw fail("Idempotency key conflicts with another upload.", 409);
      return existing;
    }
    const [asset] = await Record.create([{
      kind: "asset", title: filename, status: "STORED", createdBy: req.user._id,
      updatedBy: req.user._id, requestKey: key,
      data: { filename, mime: type, bytes: req.file.size, sha256, storage },
    }], { session });
    await service.audit(req, session, "MARKETING_ASSET_UPLOADED", asset);
    return asset;
  });
  const clean = record.toObject(); delete clean.binary;
  ok(res, clean, 201);
}));
router.get("/assets/:id", wrap(async (req, res) => {
  const asset = await Record.findOne({ _id: id(req.params.id), kind: "asset" }).select("+binary");
  if (!asset) throw fail("Asset not found.", 404);
  const bytes = asset.data.storage ? await media.retrieve(asset.data.storage) : asset.binary;
  if (!bytes || bytes.length !== asset.data.bytes ||
      crypto.createHash("sha256").update(bytes).digest("hex") !== asset.data.sha256) {
    throw fail("Stored material failed integrity verification.", 503);
  }
  res.set({ "Content-Type": asset.data.mime, "Content-Disposition": `attachment; filename="${asset.data.filename}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.send(bytes);
}));
router.get("/export/:kind", wrap(async (req, res) => {
  requireGrant(req.staffAccess, "marketing.export");
  const kind = req.params.kind, format = req.query.format;
  if (kind === "overview") {
    if (!["pdf", "xlsx"].includes(format)) throw fail("Choose PDF or Excel.");
    const report = await overview(req.query);
    const rows = [["Period", report.period.from.toISOString(), report.period.to.toISOString()],
      ...Object.entries(report.metrics).map(([key, value]) => ["KPI", key, value ?? "Unavailable"]),
      ...["campaigns", "geography", "officers", "social", "partnerships", "series"].flatMap(section =>
        report[section].map(item => [section, item.title || item.name || item.date || item.state || item.channel || "",
          JSON.stringify(item)])),
      ...report.limitations.map(item => ["Measurement boundary", item, ""])];
    await service.mutate(req, session => service.audit(req, session, "MARKETING_REPORT_EXPORTED",
      { kind: "overview", revision: 0, status: "EXPORTED", _id: null }));
    res.set("Cache-Control", "private, no-store");
    if (format === "xlsx") {
      const book = new (require("exceljs").Workbook)(), sheet = book.addWorksheet("Marketing performance");
      sheet.addRow(["Section", "Metric or record", "Value / evidence"]);
      rows.forEach(row => sheet.addRow(row));
      sheet.columns.forEach(column => { column.width = 40; });
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.attachment("servicepay-marketing-performance.xlsx");
      await book.xlsx.write(res); res.end();
    } else {
      const document = new (require("pdfkit"))({ margin: 40 });
      res.type("application/pdf").attachment("servicepay-marketing-performance.pdf");
      document.pipe(res); document.fontSize(18).text("ServicePay Marketing Performance");
      document.fontSize(10);
      rows.forEach(row => document.moveDown().text(row.join(" | ")));
      document.end();
    }
    return;
  }
  const match = filter(req, kind);
  if (!["pdf", "xlsx"].includes(format) || kind === "asset") throw fail("Choose PDF or Excel.");
  const rows = await Record.find(match).sort({ createdAt: -1 }).limit(5001).lean();
  if (rows.length > 5000) throw fail("Narrow this export to 5,000 records.", 422);
  const fields = ["title", "description", "status", "createdAt", "campaignId", "officerId"];
  const details = FIELDS[kind] || ["recordId", "recordKind", "revision", "previousStatus", "status", "reason"];
  const columns = [...fields, ...details.map(key => "data." + key)];
  const values = rows.map(row => columns.map(key => {
    const value = key.startsWith("data.") ? row.data?.[key.slice(5)] : row[key];
    return value == null ? "" : typeof value === "number" ? value : String(value);
  }));
  await service.mutate(req, session => service.audit(req, session, "MARKETING_EXPORTED",
    { kind, revision: 0, status: "EXPORTED", _id: null }, null));
  res.set("Cache-Control", "private, no-store");
  if (format === "xlsx") {
    const ExcelJS = require("exceljs");
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Marketing");
    sheet.addRow(columns); values.forEach(row => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach(column => { column.width = 30; });
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.attachment(`servicepay-marketing-${kind}.xlsx`);
    await book.xlsx.write(res); res.end();
  } else {
    const PDF = require("pdfkit"), document = new PDF({ margin: 40 });
    res.type("application/pdf").attachment(`servicepay-marketing-${kind}.pdf`);
    document.pipe(res);
    document.fontSize(18).text("ServicePay Marketing — " + kind);
    document.fontSize(10).text("Recorded data export. No customer contact or financial credentials included.");
    values.forEach(row => {
      document.moveDown().text(row.map((value, index) => `${columns[index]}: ${value}`).join("\n"));
    });
    document.end();
  }
}));
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 11000 ? 409 : error.status ||
    (error instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({ success: false,
    message: status === 503 ? error.message : status >= 500 ? "Marketing request could not be completed safely." : error.code === 11000
      ? "This customer attribution or submission already exists." : error.message });
});
module.exports = router;
module.exports.mime = mime;
