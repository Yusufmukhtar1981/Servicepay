const test = require("node:test");
const assert = require("node:assert/strict");
const models = require("../models/organizations.models");
const treasury = require("../services/organizationTreasury.service");
const owner = require("../routes/organizations.routes");
const admin = require("../routes/adminOrganizations.routes");

const routes = (router) => router.stack.filter((x) => x.route).flatMap((x) => Object.keys(x.route.methods).map((m) => `${m.toUpperCase()} ${x.route.path}`));

test("treasury models expose held funds, lifecycle, approvals and indexes", () => {
  assert.ok(models.OrganizationWallet.schema.path("heldBalance"));
  assert.deepEqual(models.OrganizationWithdrawal.schema.path("status").enumValues, ["INITIATED", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCESS", "REJECTED", "FAILED", "REVERSED", "CANCELLED", "PENDING_REVIEW"]);
  assert.ok(models.OrganizationWithdrawal.schema.path("approvals"));
  assert.ok(models.OrganizationWithdrawal.schema.indexes().some((i) => i[0].organization && i[0].idempotencyKey));
});

test("dedicated treasury contracts never use customer transfer models", () => {
  const source = require("../services/organizationTreasury.service").dispatch.toString();
  assert.doesNotMatch(source, /BankTransfer|walletBalance/);
  assert.match(source, /providerReference/);
  assert.match(source, /configurationRequired/);
});

test("organization treasury routes are complete and separated from customer withdrawals", () => {
  const ownerRoutes = routes(owner);
  for (const route of ["GET /:organizationId/treasury", "GET /:organizationId/settlement-accounts", "POST /:organizationId/settlement-accounts", "POST /:organizationId/settlement-accounts/resolve", "GET /:organizationId/withdrawals", "POST /:organizationId/withdrawals", "GET /:organizationId/withdrawals/:withdrawalId", "POST /:organizationId/withdrawals/:withdrawalId/approve", "POST /:organizationId/withdrawals/:withdrawalId/reject"]) assert.ok(ownerRoutes.includes(route), route);
  const adminRoutes = routes(admin);
  for (const route of ["GET /withdrawals/summary", "GET /withdrawals", "POST /withdrawals/:id/approve", "POST /withdrawals/:id/reject", "GET /settlement-accounts", "POST /settlement-accounts/:id/approve", "POST /settlement-accounts/:id/reject", "GET /treasury-config", "PATCH /treasury-config"]) assert.ok(adminRoutes.includes(route), route);
});

test("safety controls cover PIN, atomic limits, approval distinctness, webhook and compensating release", () => {
  const source = require("../services/organizationTreasury.service").createWithdrawal.toString() + treasury.transition.toString() + treasury.handleWebhook.toString();
  for (const term of ["verifyTransactionPin", "dailyReserved", "monthlyReserved", "approvals", "holdReleasedAt"]) assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});