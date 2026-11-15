const express = require("express");
const mongoose = require("mongoose");
const { protect, customerOnly } = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const Entry = require("../models/cashbackEntry.model");
const User = require("../models/user.model");
const Settings = require("../models/appSettings.model");
const cashback = require("../services/cashback.service");
const statements = require("../services/accountStatement.service");
const p = require("../services/customerExperiencePolicy");
const router = express.Router();
const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    // Never return provider responses, raw Mongo errors or customer details.
    res.status(error.status || 503).json({ success: false,
      message: error.status ? error.message : "This feature is temporarily unavailable. No financial retry was submitted." });
  }
};
const id = value => {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw p.fail("Invalid customer ID.");
  return new mongoose.Types.ObjectId(value);
};
const integer = (value, fallback, max = 100) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw p.fail("Invalid pagination.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw p.fail("Invalid pagination.");
  return n;
};
const paging = req => {
  const page = integer(req.query.page, 1, 100000), limit = integer(req.query.limit, 20, 100);
  return { page, limit, skip: (page - 1) * limit };
};
const noCache = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
const headOffice = (req, res, next) => {
  if (!req.staffAccess?.isHeadOffice) return res.status(403).json({ success: false, message: "Head Office access is required." });
  next();
};
const configuredAdmin = (req, res, next) => {
  if (!p.isConfiguredAdmin(req)) return res.status(403).json({
    success: false, message: "Only the configured Head Office administrator may credit cashback.",
  });
  next();
};
async function customerSummary(customerId, req, res) {
  const user = id(String(customerId)), { page, limit, skip } = paging(req);
  const filter = { user };
  const summary = await cashback.totals(filter);
  const history = (await Entry.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean())
    .map(e => { const row = cashback.project(e); delete row.actorId; delete row.customerId; return row; });
  res.json({ success: true, ...summary, balanceMinor: summary.totalMinor, history,
    page, pages: Math.ceil(summary.total / limit) });
}
const generating = new Set();
async function statementPdf(customerId, req, res) {
  const key = String(req.user._id);
  if (generating.has(key)) throw p.fail("A statement is already being generated. Please wait.", 429);
  generating.add(key);
  try {
    const data = await statements.statement(id(String(customerId)), req.query.start, req.query.end);
    const bytes = await statements.pdf(data);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition":
      `attachment; filename="ServicePay-statement-${data.start}-${data.end}.pdf"`,
    "X-Content-Type-Options": "nosniff" });
    res.send(bytes);
  } finally { generating.delete(key); }
}
router.use(protect, noCache, (req, res, next) => {
  // Express' simple parser leaves bracketed Mongo operators as literal keys;
  // reject them rather than silently treating an injected filter as "all".
  if (Object.keys(req.query).some(key => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(key))) {
    return res.status(400).json({ success: false, message: "Invalid query parameters." });
  }
  next();
});
router.get("/cashback", customerOnly, wrap((req, res) => customerSummary(req.user._id, req, res)));
router.get("/statement", customerOnly, wrap((req, res) => statementPdf(req.user._id, req, res)));
router.get("/app-update", customerOnly, wrap(async (_req, res) => {
  const settings = await Settings.findOne({ key: "GLOBAL_SETTINGS" }).select("appVersion").lean();
  res.json({ success: true, update: p.publicUpdate(settings) });
}));

router.use("/admin", loadStaffRole, headOffice);
router.get("/admin/access", (req, res) => res.json({
  success: true, canManage: true, canCreditCashback: p.isConfiguredAdmin(req),
}));
router.get("/admin/customers", wrap(async (req, res) => {
  const { page, limit, skip } = paging(req), filter = { role: "CUSTOMER" };
  const q = req.query.q;
  if (q !== undefined && (typeof q !== "string" || q.length > 120)) throw p.fail("Invalid search.");
  if (q?.trim()) {
    const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["fullName", "phone", "email"].map(field => ({ [field]: { $regex: safe, $options: "i" } }));
    if (/^[a-f\d]{24}$/i.test(q.trim())) filter.$or.push({ _id: id(q.trim()) });
  }
  const [total, customers] = await Promise.all([User.countDocuments(filter),
    User.find(filter).select("fullName phone email").sort({ _id: 1 }).skip(skip).limit(limit).lean()]);
  res.json({ success: true, customers, page, pages: Math.ceil(total / limit) });
}));
router.get("/admin/customers/:id/cashback", wrap((req, res) => customerSummary(id(req.params.id), req, res)));
router.post("/admin/customers/:id/cashback", configuredAdmin, wrap(async (req, res) => {
  const result = await cashback.credit({ customerId: id(req.params.id), actor: req.user,
    body: req.body || {}, key: req.get("X-Idempotency-Key") });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, entry: cashback.project(result.entry) });
}));
router.get("/admin/customers/:id/statement", wrap((req, res) => statementPdf(id(req.params.id), req, res)));
router.get("/admin/cashback", wrap(async (req, res) => {
  const { page, limit, skip } = paging(req), filter = {};
  if (req.query.customerId) filter.user = id(req.query.customerId);
  if (req.query.start || req.query.end) {
    const { from, to } = p.dates(req.query.start, req.query.end);
    filter.createdAt = { $gte: from, $lt: to };
  }
  for (const [key, op] of [["minMinor", "$gte"], ["maxMinor", "$lte"]]) {
    if (req.query[key] === undefined) continue;
    if (typeof req.query[key] !== "string" || !/^\d+$/.test(req.query[key])) throw p.fail("Invalid amount filter.");
    filter.amountMinor = { ...filter.amountMinor, [op]: p.minor(Number(req.query[key]), key, true) };
  }
  if (filter.amountMinor?.$gte > filter.amountMinor?.$lte) throw p.fail("Invalid amount range.");
  const summary = await cashback.totals(filter);
  const csv = req.query.format === "csv";
  if (csv && summary.total > 5000) throw p.fail("Narrow the filters to export at most 5,000 entries.", 422);
  const history = (await Entry.find(filter).sort({ createdAt: -1, _id: -1 })
    .skip(csv ? 0 : skip).limit(csv ? 5000 : limit).lean()).map(cashback.project);
  if (csv) {
    const fields = ["reference", "customerId", "actorId", "amountMinor", "description", "status", "createdAt"];
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="ServicePay-cashback.csv"' });
    res.send([fields.map(p.csvCell).join(","), ...history.map(row =>
      fields.map(field => p.csvCell(row[field] instanceof Date ? row[field].toISOString() : row[field])).join(","))].join("\r\n"));
  } else res.json({ success: true, ...summary, history, page, pages: Math.ceil(summary.total / limit) });
}));
router.get("/admin/app-update", wrap(async (_req, res) => {
  res.json({ success: true, update: p.publicUpdate(await Settings.findOne({ key: "GLOBAL_SETTINGS" }).select("appVersion").lean()) });
}));
router.put("/admin/app-update", wrap(async (req, res) => {
  const update = p.updatePayload(req.body || {});
  const set = {
    "appVersion.notificationActive": update.active, "appVersion.latestVersion": update.latestVersion,
    "appVersion.latestVersionCode": update.latestVersionCode, "appVersion.minimumVersionCode": update.minimumVersionCode,
    "appVersion.forceUpdate": update.forceUpdate, "appVersion.releaseTitle": update.releaseTitle,
    "appVersion.releaseNotes": update.releaseNotes, "appVersion.updateMessage": update.releaseNotes,
    "appVersion.androidUpdateUrl": update.playStoreUrl,
  };
  const saved = await Settings.findOneAndUpdate({ key: "GLOBAL_SETTINGS" }, {
    $set: set, $push: { "appVersion.managementHistory": {
      actorId: req.user._id, changedAt: new Date(), update,
    } },
  }, { returnDocument: "after", runValidators: true }).select("appVersion").lean();
  if (!saved) throw p.fail("Existing application settings must be provisioned before configuring updates.", 503);
  res.json({ success: true, update: p.publicUpdate(saved) });
}));
module.exports = router;
