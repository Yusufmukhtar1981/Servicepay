const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRange,
  getDateWindow,
  getRequestedDateWindow,
  hasPermission,
  buildScopeFilter,
  getDashboardTargets,
  getDashboardExport,
} = require("../services/adminDashboard.service");

test("normalizes dashboard ranges to bounded supported values", () => {
  assert.equal(normalizeRange("7D"), "7d");
  assert.equal(normalizeRange("30d"), "30d");
  assert.equal(normalizeRange("all-time"), "today");
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

test("accepts bounded custom date ranges and rejects oversized ranges", () => {
  const window = getRequestedDateWindow({
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-03-01T00:00:00.000Z",
  });
  assert.equal(window.range, "custom");
  assert.equal(window.days, 59);
  assert.throws(
    () => getRequestedDateWindow({
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-06-01T00:00:00.000Z",
    }),
    /cannot exceed/,
  );
});

test("non-management roles have a deny-by-default dashboard scope", () => {
  assert.deepEqual(
    buildScopeFilter({ role: "STAFF", _id: "staff-1" }, "transaction"),
    { _id: { $exists: false } },
  );
});

const responseRecorder = () => {
  const response = { statusCode: 200, body: null };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
};

test("target configuration is Head Office-only", async () => {
  const res = responseRecorder();
  await getDashboardTargets({ user: { role: "ZONAL_MANAGER" } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /Head Office/);
});

test("report export requires its explicit permission", () => {
  const res = responseRecorder();
  getDashboardExport({ user: { role: "ZONAL_MANAGER", permissions: [] } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /permission/);
});