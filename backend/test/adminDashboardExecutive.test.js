const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeRange,
  getDateWindow,
  hasPermission,
  buildScopeFilter,
} = require("../services/adminDashboard.service");

test("normalizes dashboard ranges to bounded supported values", () => {
  assert.equal(normalizeRange("TODAY"), "today");
  assert.equal(normalizeRange("yesterday"), "yesterday");
  assert.equal(normalizeRange("WEEK"), "week");
  assert.equal(normalizeRange("month"), "month");
  assert.equal(normalizeRange("7D"), "7d");
  assert.equal(normalizeRange("30d"), "30d");
  assert.equal(normalizeRange("all-time"), "today");
});

test("builds Lagos calendar windows for yesterday", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const window = getDateWindow("yesterday", now);
  assert.equal(window.start.toISOString(), "2026-08-28T23:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-29T23:00:00.000Z");
  assert.equal(window.previousStart.toISOString(), "2026-08-27T23:00:00.000Z");
  assert.equal(window.previousEnd.toISOString(), "2026-08-28T23:00:00.000Z");
});

test("builds adjacent current and previous periods", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const window = getDateWindow("7d", now);
  assert.equal(window.end.toISOString(), "2026-08-30T12:00:00.000Z");
  assert.equal(window.start.toISOString(), "2026-08-23T12:00:00.000Z");
  assert.equal(
    window.previousStart.toISOString(),
    "2026-08-16T12:00:00.000Z",
  );
});

test("uses the Africa/Lagos calendar day for today", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const window = getDateWindow("today", now);
  assert.equal(window.start.toISOString(), "2026-08-29T23:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-30T12:00:00.000Z");
  assert.equal(
    window.previousStart.toISOString(),
    "2026-08-28T23:00:00.000Z",
  );
  assert.equal(window.previousEnd.toISOString(), "2026-08-29T12:00:00.000Z");
});

test("keeps post-midnight Lagos activity in the new day", () => {
  const now = new Date("2026-08-29T23:15:00.000Z");
  const window = getDateWindow("today", now);
  assert.equal(window.start.toISOString(), "2026-08-29T23:00:00.000Z");
  assert.equal(window.previousEnd.toISOString(), "2026-08-28T23:15:00.000Z");
});

test("requires explicit permissions for restricted staff", () => {
  assert.equal(hasPermission({ role: "HEAD_OFFICE" }, "wallets.view"), true);
  assert.equal(
    hasPermission(
      { role: "STAFF", permissions: ["dashboard.view"] },
      "transactions.view",
    ),
    false,
  );
  assert.equal(
    hasPermission(
      {
        role: "STAFF",
        staffRole: { permissions: ["transactions.view"] },
      },
      "transactions.view",
    ),
    true,
  );
});

test("limits manager queries to the manager scope", () => {
  assert.deepEqual(
    buildScopeFilter({ role: "ZONAL_MANAGER", _id: "zone-manager" }, "user"),
    { zonalManagerId: "zone-manager" },
  );
  assert.deepEqual(
    buildScopeFilter(
      { role: "STATE_MANAGER", _id: "state-manager" },
      "transaction",
    ),
    { stateManagerId: "state-manager" },
  );
  assert.deepEqual(
    buildScopeFilter({ role: "STATE_MANAGER", _id: "manager" }, "delivery"),
    { _id: { $exists: false } },
  );
  assert.deepEqual(buildScopeFilter({ role: "HEAD_OFFICE" }), {});
});

test("mounts the executive dashboard under the protected admin router", () => {
  const routesSource = fs.readFileSync(
    path.resolve(__dirname, "../routes/admin.routes.js"),
    "utf8",
  );
  assert.match(routesSource, /getAdminExecutiveDashboard/);
  assert.match(
    routesSource,
    /router\.get\(\s*"\/dashboard\/executive"[\s\S]*?protect[\s\S]*?loadStaffRole[\s\S]*?requirePermission\(P\.DASHBOARD_VIEW\)[\s\S]*?getAdminExecutiveDashboard/,
  );
});