const assert = require("node:assert/strict");
const test = require("node:test");

const { __dashboardTest } = require("../controllers/branch.controller");

const requestWith = (permissions, query = {}) => ({
  query,
  staffAccess: {
    isHeadOffice: false,
    permissions,
  },
  branchScope: {
    assignedModules: ["DELIVERY", "MARKETPLACE", "SOLAR", "PHONE_FINANCING"],
  },
});

test("dashboard date-only filters use Lagos midnight and an exclusive next day", () => {
  const range = __dashboardTest.requestedDateRange(requestWith([], {
    startDate: "2026-09-01",
    endDate: "2026-09-01",
  }));

  assert.equal(range.$gte.toISOString(), "2026-08-31T23:00:00.000Z");
  assert.equal(range.$lt.toISOString(), "2026-09-01T23:00:00.000Z");
});

test("target filters select records overlapping the requested Lagos period", () => {
  const filter = __dashboardTest.targetDateFilter(requestWith([], {
    startDate: "2026-09-01",
    endDate: "2026-09-07",
  }));

  assert.equal(filter.endDate.$gte.toISOString(), "2026-08-31T23:00:00.000Z");
  assert.equal(filter.startDate.$lt.toISOString(), "2026-09-07T23:00:00.000Z");
});

test("dashboard revenue includes only modules the manager may view", () => {
  const metrics = {
    transactions: { value: 100 },
    deliveries: { value: 200 },
    marketplace: { value: 300 },
    solar: { payments: { value: 400 } },
    phoneFinancing: { payments: { value: 500 } },
  };

  assert.equal(
    __dashboardTest.permittedRevenue(
      requestWith(["branch.finance.view"]),
      metrics,
    ),
    100,
  );
  assert.equal(
    __dashboardTest.permittedRevenue(
      requestWith(["branch.delivery.view"]),
      metrics,
    ),
    200,
  );
  assert.equal(__dashboardTest.permittedRevenue(requestWith([]), metrics), null);
});