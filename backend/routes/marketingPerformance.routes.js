"use strict";
const express = require("express");
const { Record, fail, id, mutate, audit } = require("../services/marketing.service");
const perf = require("../services/marketingPerformance.service");
const access = require("../services/marketingAccess.service");
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const ARCHIVABLE = ["target", "report", "task", "campaign", "content", "performance"];
router.get("/context", wrap(async (req, res) => ok(res, {
  role: req.staffAccess.roleName, manager: !!access.leadership(req),
  headOffice: req.staffAccess.isHeadOffice === true, superAdmin: access.superAdmin(req),
  actorId: req.user._id, periods: perf.PERIODS, metrics: perf.METRICS,
  policy: await perf.policy(),
})));
router.get("/me", wrap(async (req, res) => ok(res, await perf.dashboard(req))));
router.get("/staff/:id", wrap(async (req, res) => ok(res, await perf.dashboard(req, req.params.id))));
router.get("/department", wrap(async (req, res) => {
  const result = await perf.department(req, req.query);
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  const search = String(req.query.search || "").slice(0, 100).toLowerCase();
  const rows = result.items.filter(r => !search || r.name.toLowerCase().includes(search));
  ok(res, { ...result, items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit });
}));
router.get("/ranking-policy", wrap(async (req, res) => ok(res, await perf.policy())));
router.patch("/ranking-policy", wrap(async (req, res) => {
  if (!access.superAdmin(req)) throw fail("Only Super Admin can configure the ranking methodology.", 403);
  const weights = req.body.weights, revision = req.body.revision;
  if (!weights || Object.keys(weights).sort().join() !== Object.keys(perf.WEIGHTS).sort().join() ||
    Object.values(weights).some(v => !Number.isInteger(v) || v < 0 || v > 100) ||
    Object.values(weights).reduce((s, v) => s + v, 0) !== 100 ||
    !Number.isSafeInteger(revision) || revision < 0 ||
    typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 1000) throw fail("Provide all six non-negative whole-number weights totalling 100, revision and a reason.");
  const row = await mutate(req, async session => {
    const old = await Record.findById(perf.POLICY_ID).session(session);
    if ((old?.revision || 0) !== revision) throw fail("Policy changed; reload before saving.", 409);
    const before = old?.toObject();
    const record = old || new Record({ _id: perf.POLICY_ID, kind: "rankingPolicy",
      title: "Marketing ranking methodology", status: "ACTIVE", createdBy: req.user._id,
      updatedBy: req.user._id, requestKey: "marketing_ranking_policy_v1" });
    record.data = { weights, reason: req.body.reason, changedAt: new Date().toISOString() };
    record.updatedBy = req.user._id; record.revision++;
    await record.save({ session });
    await audit(req, session, "MARKETING_RANKING_POLICY_CHANGED", record, before);
    return record;
  });
  ok(res, { ...await perf.policy(), revision: row.revision });
}));
router.post("/snapshot", wrap(async (req, res) => ok(res, await perf.snapshot(req, req.body), 201)));
router.get("/archive", wrap(async (req, res) => {
  const kind = req.query.kind;
  if (kind && !ARCHIVABLE.includes(kind)) throw fail("Choose an archive record type.");
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid pagination.");
  const scope = access.scope(req, "archive");
  const match = { $and: [scope, { kind: kind || { $in: ARCHIVABLE } }] };
  if (req.query.archived === "true") match.$and.push({ "data.archivedAt": { $exists: true } });
  if (req.query.archived === "false") match.$and.push({ "data.archivedAt": { $exists: false } });
  if (req.query.status) match.$and.push({ status: String(req.query.status).slice(0, 40) });
  if (req.query.period) {
    if (!perf.PERIODS.includes(req.query.period)) throw fail("Invalid period.");
    match.$and.push({ "data.period": req.query.period });
  }
  if (req.query.from || req.query.to) {
    const range = perf.dates(req.query);
    match.$and.push({ $or: [
      { "data.startsAt": { $gte: range.from.toISOString(), $lt: range.to.toISOString() } },
      { "data.startsAt": { $exists: false }, createdAt: { $gte: range.from, $lt: range.to } },
    ] });
  }
  if (req.query.search) match.$and.push({ title: { $regex: String(req.query.search).slice(0, 100)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } });
  const [items, total] = await Promise.all([Record.find(match).sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit).limit(limit).lean(), Record.countDocuments(match)]);
  ok(res, { items, total, page, limit });
}));
router.get("/history/:kind/:id", wrap(async (req, res) => {
  if (!ARCHIVABLE.includes(req.params.kind)) throw fail("Invalid history type.");
  const row = await Record.findOne({ _id: id(req.params.id), kind: req.params.kind }).lean();
  if (!row) throw fail("Record not found.", 404);
  access.assertVisible(req, row);
  const items = await Record.find({ kind: "activity", "data.recordId": String(row._id) })
    .sort({ createdAt: -1 }).limit(200).lean();
  ok(res, { record: row, items });
}));
router.post("/archive/:kind/:id", wrap(async (req, res) => {
  const kind = req.params.kind;
  if (!ARCHIVABLE.includes(kind) || typeof req.body.archived !== "boolean" ||
    !Number.isSafeInteger(req.body.revision) || typeof req.body.reason !== "string" ||
    !req.body.reason.trim() || req.body.reason.length > 1000) throw fail("Select a record, revision and archive reason.");
  const record = await mutate(req, async session => {
    const row = await Record.findOne({ _id: id(req.params.id), kind }).session(session);
    if (!row) throw fail("Record not found.", 404);
    access.assertVisible(req, row);
    if (["target", "task", "campaign", "content", "performance"].includes(kind) && !access.leadership(req)) throw fail("Only managers archive assigned or verified records.", 403);
    if (kind === "report" && !access.leadership(req) && !access.own(req, row)) throw fail("Only your reports are accessible.", 403);
    if (row.revision !== req.body.revision) throw fail("Record changed; reload.", 409);
    if (req.body.archived && kind === "target" && new Date(row.data.endsAt) > new Date()) throw fail("Current targets cannot be archived.", 409);
    if (req.body.archived && kind === "task" && row.status !== "COMPLETED") throw fail("Complete the assignment before archiving.", 409);
    const before = row.toObject();
    const data = { ...row.data };
    if (req.body.archived) {
      data.archivedAt = new Date().toISOString(); data.archivedBy = String(req.user._id);
    } else { delete data.archivedAt; delete data.archivedBy; }
    row.data = data; row.revision++; row.updatedBy = req.user._id;
    await row.save({ session });
    // The immutable archive event includes a snapshot; the source stays intact.
    const [event] = await Record.create([{ kind: "archive", title: row.title,
      status: req.body.archived ? "ARCHIVED" : "RESTORED", officerId: row.officerId || row.createdBy,
      createdBy: req.user._id, updatedBy: req.user._id, requestKey: "archive_" + new (require("mongoose").Types.ObjectId)(),
      data: { recordId: String(row._id), recordKind: kind, snapshot: before, reason: req.body.reason } }], { session });
    await audit(req, session, event.status === "ARCHIVED" ? "MARKETING_ARCHIVED" : "MARKETING_RESTORED", row, before);
    return row;
  });
  ok(res, record);
}));
router.get("/notifications", wrap(async (req, res) => {
  // Reminders are also produced by the background worker. This refresh never
  // sends SMS/email and cannot authorize a financial operation.
  if (req.user.department === "MARKETING") {
    try { await perf.reminders(req); } catch (error) { if (error.code !== 11000) throw error; }
  }
  const items = await Record.find({ kind: "notification", officerId: req.user._id })
    .sort({ createdAt: -1 }).limit(100).lean();
  ok(res, { items });
}));
router.post("/notifications/:id/read", wrap(async (req, res) => {
  const row = await Record.findOneAndUpdate({ _id: id(req.params.id), kind: "notification",
    officerId: req.user._id }, { $set: { status: "READ" } }, { new: true }).lean();
  if (!row) throw fail("Notification not found.", 404);
  ok(res, row);
}));
router.get("/export", wrap(async (req, res) => {
  const format = req.query.format;
  if (!["pdf", "xlsx"].includes(format)) throw fail("Choose pdf or xlsx.");
  let report;
  if (req.query.department === "true") report = await perf.department(req, req.query);
  else {
    const user = await perf.staff(req, req.query.officerId);
    const period = perf.dates(req.query);
    report = { staff: { id: String(user._id), name: user.fullName }, period,
      ...await perf.measure(user._id, period.from, period.to), methodology: await perf.policy() };
  }
  const lines = [];
  function flatten(value, prefix = "") {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      for (const [key, child] of Object.entries(value)) flatten(child, prefix ? prefix + "." + key : key);
    } else lines.push([prefix, value == null ? "Unavailable" : String(value)]);
  }
  flatten(report);
  await mutate(req, session => audit(req, session, "MARKETING_PERFORMANCE_EXPORTED",
    { kind: "performance", _id: null, revision: 0, status: "EXPORTED" }));
  res.set("Cache-Control", "private, no-store");
  if (format === "xlsx") {
    const workbook = new (require("exceljs").Workbook)(), sheet = workbook.addWorksheet("Performance");
    sheet.addRow(["Metric", "Verified value"]); lines.forEach(row => sheet.addRow(row));
    sheet.columns.forEach(c => { c.width = 45; });
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment("servicepay-marketing-performance.xlsx");
    await workbook.xlsx.write(res); res.end();
  } else {
    const doc = new (require("pdfkit"))({ margin: 40 });
    res.type("application/pdf").attachment("servicepay-marketing-performance.pdf");
    doc.pipe(res); doc.fontSize(18).text("ServicePay staff performance");
    doc.fontSize(10); lines.forEach(row => doc.moveDown().text(row.join(": "))); doc.end();
  }
}));
module.exports = router;
