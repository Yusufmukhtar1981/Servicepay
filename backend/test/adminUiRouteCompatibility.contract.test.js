const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routes = fs.readFileSync(path.join(__dirname, "../routes/admin.routes.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const fintechRoutes = fs.readFileSync(
  path.join(__dirname, "../routes/fintechOperations.routes.js"),
  "utf8"
);

for (const endpoint of [
  "/customer360/search",
  "/customer360/:customerId",
  "/customer360/:customerId/timeline",
  "/customer360/:customerId/transactions",
  "/transaction-intelligence/summary",
  "/transaction-intelligence/transactions",
  "/transaction-intelligence/queue",
  "/riders",
  "/bank-reconciliation",
  "/transaction-requery",
]) {
  test(`Admin UI backend route exists: ${endpoint}`, () => {
    assert.match(routes, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("Keke Fare Admin router is mounted", () => {
  assert.match(index, /app\.use\("\/api\/admin\/keke-fare", adminKekeFareSettingRoutes\)/);
});

for (const endpoint of [
  "/customers",
  "/wallet-holds",
  "/failed-transactions",
  "/virtual-accounts",
  "/dedicated-accounts",
  "/bank-partners",
  "/routing-status",
  "/fraud-alerts",
  "/watchlist",
  "/login-risk",
  "/financial-actions",
  "/disputes",
]) {
  test(`Fintech Operations UI route exists: ${endpoint}`, () => {
    assert.match(
      fintechRoutes,
      new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  });
}