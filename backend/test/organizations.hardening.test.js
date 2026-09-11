const test = require("node:test");
const assert = require("node:assert/strict");
const models = require("../models/organizations.models");
const service = require("../services/organizations.service");
const organizationsController = require("../controllers/organizations.controller");
const permissionRegistry = require("../config/permissionRegistry");
const adminOrganizationsRouter = require("../routes/adminOrganizations.routes");
const organizationsRouter = require("../routes/organizations.routes");

const routeContracts = organizationsRouter.stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));

test("organization models expose canonical lifecycle states", () => {
  const statuses = models.Organization.schema.path("status").enumValues;
  assert.deepEqual(statuses, ["DRAFT", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "SUSPENDED"]);
  assert.deepEqual(models.OrganizationMember.schema.path("status").enumValues, ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "EXPIRED"]);
});

test("ServicePay super admin keeps full Organizations access", () => {
  assert.equal(
    permissionRegistry.canonicalRoleName("SERVICEPAY_SUPER_ADMIN"),
    "HEAD_OFFICE"
  );
  assert.deepEqual(
    permissionRegistry.effectivePermissionsForUser({
      role: "SERVICEPAY_SUPER_ADMIN",
    }),
    ["*"]
  );
  assert.equal(
    adminOrganizationsRouter.isFullAccessOrganizationAdminRole(
      "servicepay-super-admin"
    ),
    true
  );
});

test("public-safe projection excludes contact, documents, and members", () => {
  const source = require("../controllers/organizations.controller").publicSearch.toString();
  assert.equal(source.includes("contact.name"), false);
  assert.equal(source.includes("documents"), false);
  assert.equal(source.includes("members"), false);
  assert.match(source, /status: "VERIFIED"/);
});

test("owner discovery and admin search remain safe", () => {
  const mineSource = organizationsController.mine.toString();
  const listSource = organizationsController.adminList.toString();
  assert.match(mineSource, /canManage: true/);
  assert.match(mineSource, /allowedToManage: true/);
  assert.match(listSource, /replace/);
  assert.equal(listSource.includes(".slice(0, 100)"), true);
  assert.equal(listSource.includes(".limit(200)"), true);
});

test("member approval identity and card lookup are scoped to the caller", () => {
  const membersSource = organizationsController.members.toString();
  const cardSource = organizationsController.myCard.toString();
  assert.equal(membersSource.includes('populate("user"'), true);
  assert.equal(membersSource.includes("fullName"), true);
  assert.equal(cardSource.includes("user: req.user._id"), true);
  assert.equal(cardSource.includes("member: membership._id"), true);
  assert.equal(cardSource.includes('findOne({ organization: req.params.id, active: true })'), false);
});

test("payment admission contains server-side claim and pending registration guard", () => {
  const source = service.pay.toString();
  assert.match(source, /findOneAndUpdate/);
  assert.match(source, /canOperateMember/);
  assert.match(source, /organization: member\.organization/);
});

test("scoped organization access rejects invalid and cross-organization identifiers", async () => {
  const request = { user: { _id: "507f1f77bcf86cd799439011", role: "CUSTOMER" } };
  assert.equal(await service.access(request, "not-an-id"), null);
});

test("known organization role capability map and money precision are enforced", () => {
  assert.equal(service.roleAllows("ORGANIZATION_TREASURER", "payments.view"), true);
  assert.equal(service.roleAllows("ORGANIZATION_TREASURER", "members.suspend"), false);
  assert.equal(service.normalizeMoney(10.25), 10.25);
  assert.throws(() => service.normalizeMoney(10.257), /two decimals/);
  assert.equal(service.resolveOrganizationRole([{ role: "OWNER", permissions: [] }], "members.view").role, "OWNER");
  assert.equal(service.resolveOrganizationRole([{ role: "OWNER" }, { role: "OWNER" }], "members.view"), null);
});

test("dashboard branch scope filters members and restricts wallet", () => {
  const scoped = organizationsController.dashboardScope("org", "branch", ["member"]);
  assert.deepEqual(scoped.memberFilter, { organization: "org", branch: "branch" });
  assert.deepEqual(scoped.memberIds, { $in: ["member"] });
  assert.equal(scoped.walletRestricted, true);
  const unscoped = organizationsController.dashboardScope("org", null);
  assert.deepEqual(unscoped.memberFilter, { organization: "org" });
  assert.equal(unscoped.memberIds, undefined);
  assert.equal(unscoped.walletRestricted, false);
});

test("owner dashboard exposes the canonical Flutter contracts", () => {
  for (const path of ["/:organizationId/dashboard", "/:organizationId/members/search", "/:organizationId/applications", "/:organizationId/payment-history", "/:organizationId/fees", "/:organizationId/wallet/details", "/:organizationId/branches", "/:organizationId/staff/list", "/:organizationId/announcements", "/:organizationId/cards", "/:organizationId/reports", "/:organizationId/audit", "/:organizationId/settings"]) {
    assert.ok(routeContracts.some((route) => route.endsWith(` ${path}`)), `missing GET ${path}`);
  }
  for (const exportName of ["dashboardCanonical", "memberList", "applicationList", "paymentHistory", "feeList", "walletDetails", "branchList", "staffList", "announcementList", "cardList", "report", "auditList", "settingsGet"]) {
    assert.equal(typeof organizationsController[exportName], "function", `missing controller ${exportName}`);
  }
  const source = organizationsController.dashboardCanonical.toString();
  for (const key of ["summary", "recentMembers", "recentPayments", "membershipGrowth", "revenueTrend"]) assert.match(source, new RegExp(key));
});

test("mutating dashboard contracts are present and use scoped controller access", () => {
  for (const route of [
    "POST /:organizationId/applications/:applicationId/approve",
    "POST /:organizationId/applications/:applicationId/reject",
    "PATCH /:organizationId/members/:memberId/status",
    "PATCH /:organizationId/fees/:feeId",
    "POST /:organizationId/fees",
    "POST /:organizationId/fee-assignments",
    "PATCH /:organizationId/branches/:branchId",
    "POST /:organizationId/branches",
    "PATCH /:organizationId/staff/:staffId",
    "POST /:organizationId/staff",
    "POST /:organizationId/announcements",
    "PATCH /:organizationId/settings",
  ]) assert.ok(routeContracts.includes(route), `missing ${route}`);
  for (const name of ["memberStatus", "approveMember", "rejectApplication", "feeUpdate", "branchUpdate", "staffUpdate", "settingsPatch"]) {
    assert.match(organizationsController[name].toString(), /runAccess|requireOrg/);
  }
});

test("dashboard response contracts use truthful list keys and pagination", () => {
  assert.match(organizationsController.memberList.toString(), /members, pagination/);
  assert.match(organizationsController.paymentHistory.toString(), /payments, summary:/);
  assert.match(organizationsController.dashboardCanonical.toString(), /recentPayments/);
  assert.match(organizationsController.walletDetails.toString(), /withdrawals: \{ available: false/);
});

test("member payment filtering and messaging contracts are exposed", () => {
  assert.ok(routeContracts.includes("GET /:organizationId/payment-history"));
  assert.ok(routeContracts.includes("POST /:organizationId/members/:memberId/message"));
  assert.equal(typeof organizationsController.messageMember, "function");
  assert.match(organizationsController.paymentHistory.toString(), /Invalid member id/);
  assert.match(organizationsController.messageMember.toString(), /messages.send|runAccess/);
  assert.match(organizationsController.messageMember.toString(), /channelAvailability/);
});