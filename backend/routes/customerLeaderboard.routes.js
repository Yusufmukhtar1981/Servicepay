const express = require("express");
const { protect, customerOnly } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const service = require("../services/customerLeaderboard.service");
const router = express.Router();
router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const guarded = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    if (!error.status) console.error("Customer leaderboard report failed."); // Never raw PII/provider payloads.
    res.status(error.status || 503).json({ success: false,
      message: error.status ? error.message : "Leaderboard is temporarily unavailable. Please retry shortly." });
  }
};
const headOffice = permission => [protect, loadStaffRole,
  (req, res, next) => req.staffAccess?.isHeadOffice ? next() :
    res.status(403).json({ success: false, message: "Head Office access is required." }),
  requirePermission(permission)];
function query(req) {
  if (Object.keys(req.query).some(k => !["month", "limit", "sort"].includes(k))) {
    throw Object.assign(new Error("Unsupported report filter."), { status: 400 });
  }
  if (req.query.month !== undefined && typeof req.query.month !== "string") throw Object.assign(new Error("Invalid month."), { status: 400 });
  const month = service.period(req.query.month).month;
  const limit = Number(req.query.limit || 10), sort = req.query.sort || "count";
  if (![10, 50, 100].includes(limit) || !["count", "value"].includes(sort)) {
    throw Object.assign(new Error("Use limit 10, 50 or 100 and sort count or value."), { status: 400 });
  }
  return { month, limit, sort, admin: true };
}
router.get("/privacy", protect, customerOnly, guarded(async (req, res) => {
  if (Object.keys(req.query).length) throw Object.assign(new Error("Unsupported privacy filter."), { status: 400 });
  res.json({ success: true, data: await service.privacy(req.user._id) });
}));
router.patch("/privacy", protect, customerOnly, guarded(async (req, res) => {
  if (Object.keys(req.query).length) throw Object.assign(new Error("Unsupported privacy filter."), { status: 400 });
  res.json({ success: true, data: await service.updatePrivacy(req.user._id, req.body) });
}));
router.get("/admin/settings", ...headOffice("settings.view"), guarded(async (req, res) =>
  res.json({ success: true, data: await service.settings() })));
router.patch("/admin/settings", ...headOffice("settings.update"), guarded(async (req, res) =>
  res.json({ success: true, data: await service.updateSettings(req.body, req.user) })));
router.get("/admin/history", ...headOffice("settings.view"), guarded(async (req, res) => {
  const [year, mm] = service.currentMonth().split("-").map(Number);
  const months = Array.from({ length: 24 }, (_, n) => {
    const d = new Date(Date.UTC(year, mm - 1 - n, 15));
    return d.toISOString().slice(0, 7);
  });
  res.json({ success: true, data: { months } });
}));
router.get("/admin/export", ...headOffice("settings.view"), guarded(async (req, res) => {
  const data = await service.report(query(req));
  const cell = value => {
    const text = String(value);
    // Full registered names are untrusted spreadsheet input, even with consent.
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? "'" + text : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = ["Month,Ranking,Position,Customer display name,Successful transactions,Transaction value NGN",
    ...data.rows.map(row => [data.period.month, req.query.sort || "count", row.rank,
      row.displayName, row.count, row.value.toFixed(2)].map(cell).join(","))];
  res.type("text/csv").set("Content-Disposition", `attachment; filename="Servicepay-Champions-${data.period.month}-${req.query.sort || "count"}.csv"`)
    .send("\uFEFF" + lines.join("\r\n"));
}));
router.get("/admin", ...headOffice("settings.view"), guarded(async (req, res) =>
  res.json({ success: true, data: await service.report(query(req)) })));
router.get("/", protect, customerOnly, guarded(async (req, res) => {
  if (Object.keys(req.query).some(k => k !== "month")) {
    throw Object.assign(new Error("Unsupported report filter."), { status: 400 });
  }
  service.period(req.query.month);
  res.json({ success: true, data: await service.report({ month: req.query.month, customerId: req.user._id }) });
}));
module.exports = router;
