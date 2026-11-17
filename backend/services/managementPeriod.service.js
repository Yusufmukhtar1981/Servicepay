"use strict";
const DAY = 86400000, OFFSET = 3600000;
const PRESETS = ["TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH", "LAST_7_DAYS", "LAST_30_DAYS", "CUSTOM"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function localDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail("Use YYYY-MM-DD dates.");
  const d = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw fail("Invalid calendar date.");
  return d;
}
function period(query = {}, now = new Date()) {
  const preset = String(query.period || "THIS_MONTH").toUpperCase();
  if (!PRESETS.includes(preset)) throw fail("Unknown date filter.");
  const today = new Date(+now + OFFSET);
  today.setUTCHours(0, 0, 0, 0);
  let from = new Date(today), to = new Date(+today + DAY);
  if (preset === "YESTERDAY") { from = new Date(+today - DAY); to = today; }
  if (preset === "THIS_WEEK" || preset === "LAST_WEEK") {
    from = new Date(+today - ((today.getUTCDay() + 6) % 7) * DAY);
    to = new Date(+from + 7 * DAY);
    if (preset === "LAST_WEEK") { to = from; from = new Date(+from - 7 * DAY); }
  }
  if (preset === "THIS_MONTH" || preset === "LAST_MONTH") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    if (preset === "LAST_MONTH") {
      to = from; from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    }
  }
  if (preset === "LAST_30_DAYS") from = new Date(+today - 29 * DAY);
  if (preset === "LAST_7_DAYS") from = new Date(+today - 6 * DAY);
  if (preset === "CUSTOM") { from = localDate(query.from); to = new Date(+localDate(query.to) + DAY); }
  if (+to <= +from || +to - +from > 366 * DAY) throw fail("Select an ordered date range of at most 366 days.");
  const result = { preset, timezone: "Africa/Lagos", from: new Date(+from - OFFSET), to: new Date(+to - OFFSET) };
  result.previous = { from: new Date(+result.from - (+to - +from)), to: result.from };
  return result;
}
function targetPeriod(body) {
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(body.period)) throw fail("Choose DAILY, WEEKLY or MONTHLY.");
  const day = localDate(body.startDate);
  const p = period({ period: { DAILY: "TODAY", WEEKLY: "THIS_WEEK", MONTHLY: "THIS_MONTH" }[body.period] }, new Date(+day + 12 * 3600000));
  return { from: p.from, to: p.to };
}
module.exports = { period, targetPeriod, PRESETS, fail, DAY };
