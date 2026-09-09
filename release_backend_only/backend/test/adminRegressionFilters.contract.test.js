const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const controllerSource = fs.readFileSync(
  require.resolve("../controllers/admin.controller"),
  "utf8",
);
const routesSource = fs.readFileSync(
  require.resolve("../routes/admin.routes"),
  "utf8",
);

test("transaction filters retain legacy status aliases without rejecting unknown optional values", () => {
  for (const status of [
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "PENDING",
    "PROCESSING",
    "FAILED",
    "REVERSED",
    "REFUNDED",
  ]) {
    assert.match(controllerSource, new RegExp(`\\b${status}:`));
  }
  const start = controllerSource.indexOf("exports.getAdminTransactions =");
  const end = controllerSource.indexOf("exports.unassignRiderFromDelivery", start);
  const handler = controllerSource.slice(start, end);
  assert.doesNotMatch(handler, /Invalid transaction status/);
});

test("full Head Office role aliases can load all transactions", () => {
  assert.match(
    routesSource,
    /const HEAD_OFFICE_ROLES = \[[\s\S]*"HEAD_OFFICE"[\s\S]*"ADMIN"[\s\S]*"SUPER_ADMIN"[\s\S]*"HEAD_OFFICE_ADMIN"/,
  );
  assert.match(
    routesSource,
    /"\/transactions"[\s\S]*adminOnly\(\.\.\.HEAD_OFFICE_ROLES\)[\s\S]*getAdminTransactions/,
  );
});

test("delivery filters support assigned and legacy aliases without rejecting optional filters", () => {
  for (const status of [
    "PENDING",
    "ASSIGNED",
    "ACCEPTED",
    "PICKED_UP",
    "IN_TRANSIT",
    "DELIVERED",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
    "REFUNDED",
  ]) {
    assert.match(controllerSource, new RegExp(`\\b${status}:`));
  }
  const start = controllerSource.indexOf("exports.getAdminDeliveries =");
  const end = controllerSource.indexOf("exports.updateDeliveryStatus =", start);
  const handler = controllerSource.slice(start, end);
  assert.doesNotMatch(handler, /Invalid delivery status/);
});