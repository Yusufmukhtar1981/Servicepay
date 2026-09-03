const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("Admin dashboard only populates current Transaction relationships", () => {
  const source = fs.readFileSync(require.resolve("../controllers/admin.controller"), "utf8");
  const start = source.indexOf("exports.getAdminDashboard =");
  const end = source.indexOf("exports.getAdminTransactions =", start);
  const dashboard = source.slice(start, end);
  assert.match(dashboard, /\.populate\(\s*"customerId"/);
  assert.doesNotMatch(dashboard, /\.populate\(\s*"userId"/);
});

test("Admin transaction list only populates current Transaction relationships", () => {
  const source = fs.readFileSync(require.resolve("../controllers/admin.controller"), "utf8");
  const start = source.indexOf("exports.getAdminTransactions =");
  const end = source.indexOf("exports.unassignRiderFromDelivery", start);
  const transactions = source.slice(start, end);
  assert.match(transactions, /\.populate\(\s*"customerId"/);
  assert.doesNotMatch(transactions, /\.populate\(\s*"userId"/);
});
