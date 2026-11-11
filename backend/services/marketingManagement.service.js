"use strict";
const { Record, fail } = require("./marketing.service");
const perf = require("./marketingPerformance.service");

const usable = row => ["ACTIVE", "COMPLETED"].includes(row.status) && !row.data.archivedAt;
const average = rows => {
  const values = rows.filter(r => usable(r) && r.achievementPercent != null);
  return values.length ? values.reduce((sum, r) => sum + Math.min(100, r.achievementPercent), 0) / values.length : null;
};
async function management(req) {
  if (!req.staffAccess.isHeadOffice) throw fail("Central Marketing Management is authorized Admin-only.", 403);
  const range = perf.dates(req.query);
  const cache = new Map(), targets = [];
  const report = await perf.department(req, req.query, cache);
  const stored = await perf.bounded(Record.find({ kind: "target",
    "data.archivedAt": { $exists: false } }).sort({ createdAt: -1 }), 1000);
  for (const row of stored) targets.push(await perf.targetResult(row, cache));
  const selected = targets.filter(t => t.data.period === range.period &&
    new Date(t.data.startsAt) >= range.from && new Date(t.data.endsAt) <= range.to);
  const active = selected.filter(usable);
  let staff = report.items;
  const search = String(req.query.search || "").trim().toLowerCase();
  if (search.length > 100) throw fail("Search must be at most 100 characters.");
  if (search) staff = staff.filter(r => r.name.toLowerCase().includes(search));
  const performance = req.query.performance;
  if (performance && !["MEETING", "BELOW", "UNAVAILABLE"].includes(performance)) throw fail("Invalid performance filter.");
  if (performance) staff = staff.filter(r => performance === "UNAVAILABLE" ? r.achievement == null :
    r.achievement != null && (performance === "MEETING" ? r.achievement >= 100 : r.achievement < 100));
  const pendingReports = await Record.countDocuments({ kind: "report", status: "SUBMITTED",
    "data.startsAt": { $gte: range.from.toISOString(), $lt: range.to.toISOString() } });
  return {
    period: range.period, from: range.from, to: range.to,
    summary: {
      teamMembers: report.items.length, assignedTargets: active.length,
      verifiedAchievements: active.filter(t => t.actual != null && t.achievementPercent >= 100).length,
      staffMeetingTargets: report.items.filter(r => r.achievement != null && r.achievement >= 100).length,
      staffBelowTargets: report.items.filter(r => r.achievement != null && r.achievement < 100).length,
      departmentPerformance: average(active), pendingReports,
    },
    periods: perf.PERIODS.map(period => {
      const b = perf.bounds(period);
      const rows = targets.filter(t => usable(t) && t.data.period === period &&
        new Date(t.data.startsAt) >= b.from && new Date(t.data.endsAt) <= b.to);
      return { period, assignedTargets: rows.length, achievementPercent: average(rows) };
    }),
    staff, targets, departmentTargets: report.departmentTargets, metrics: perf.METRICS,
    note: "Verified achievements counts completed measurable targets, not mixed KPI units or unique customers. " +
      "Independent periods are not added together. Paused, inactive and archived targets are excluded from performance. " +
      "Registrations require confirmed attribution. Agent, merchant, custom KPI and attendance measurements remain unavailable without a trusted source. " +
      "Attendance records are self-reported activity, not verified attendance.",
  };
}
module.exports = { management };
