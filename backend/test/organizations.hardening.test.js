const test = require("node:test");
const assert = require("node:assert/strict");
const models = require("../models/organizations.models");
const service = require("../services/organizations.service");
const organizationsController = require("../controllers/organizations.controller");
const permissionRegistry = require("../config/permissionRegistry");
const adminOrganizationsRouter = require("../routes/adminOrganizations.routes");

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