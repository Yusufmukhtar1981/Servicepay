const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Branch = require("../models/branch.model");
const SVPReport = require("../models/svpReport.model");
const Audit = require("../models/adminAuditLog.model");
const svp = require("../controllers/svp.controller");
const { validateSVPPermissions } = require("../services/svpPermission.service");
const { normalizeScope, filterFor } = require("../services/svpScope.service");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");

let repl, ho, first, second, branch;
process.env.JWT_SECRET = process.env.JWT_SECRET || "svp-test-secret";
const res = () => ({ statusCode: 200, body: null, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
const req = (user, body = {}, params = {}, query = {}) => ({ user, body, params, query, ip: "127.0.0.1", method: "POST", baseUrl: "/api/svp", path: "/", headers: {} });
const invoke = async (handler, request) => { const response = res(); await handler(request, response, (error) => { throw error; }); return response; };
const middlewareChain = async (handlers, request) => {
  const response = res();
  let reached = false;
  const run = async (index) => {
    if (index === handlers.length) { reached = true; return; }
    await handlers[index](request, response, (error) => error ? Promise.reject(error) : run(index + 1));
  };
  await run(0);
  return { response, reached };
};

test.before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(repl.getUri());
  ho = await User.create({ fullName: "Head Office", phone: "08000000001", email: "ho@svp.test", password: "StrongPass1!", role: "HEAD_OFFICE" });
  branch = await Branch.create({ code: "SVP01", name: "SVP Branch", state: "Lagos", createdBy: ho._id });
});
test.after(async () => { await mongoose.disconnect(); await repl.stop(); });

test("Head Office creates isolated SVPs, honors status, and unique identity constraints", async () => {
  const base = { fullName: "First SVP", executiveId: "SVP-001", email: "first@svp.test", phone: "08000000002", password: "StrongPass1!", title: "Operations SVP", department: "OPERATIONS", permissions: ["dashboard.view", "reports.view", "audit.view", "transaction_intelligence.view"], scope: { type: "BRANCHES", branchIds: [branch._id] } };
  let response = await invoke(svp.create, req(ho, base)); assert.equal(response.statusCode, 201); first = await User.findById(response.body.data.id).select("+authTokenVersion");
  response = await invoke(svp.create, req(ho, { ...base, fullName: "Second SVP", executiveId: "SVP-002", email: "second@svp.test", phone: "08000000003", status: "SUSPENDED", scope: { type: "STATE", state: "Abuja" } })); assert.equal(response.statusCode, 201); second = await User.findById(response.body.data.id);
  assert.equal(second.status, "SUSPENDED");
  response = await invoke(svp.create, req(ho, { ...base, email: "other@svp.test", phone: "08000000004" })); assert.equal(response.statusCode, 409);
});

test("strict SVP permission allowlist rejects privileged writes", () => {
  for (const permission of ["wallets.adjust", "settings.update", "roles.update", "staff.create", "transactions.reverse"]) {
    assert.equal(validateSVPPermissions(["dashboard.view", permission]).valid, false);
  }
});

test("route middleware chain enforces protect, exact role, and permission", async () => {
  const token = jwt.sign({ id: first._id, authTokenVersion: 0 }, process.env.JWT_SECRET);
  const request = { headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/svp/me/metrics", url: "/api/svp/me/metrics" };
  let result = await middlewareChain([protect, adminOnly("SVP"), loadStaffRole, requirePermission("dashboard.view")], request);
  assert.equal(result.reached, true);
  result = await middlewareChain([protect, adminOnly("SVP"), loadStaffRole, requirePermission("settings.update")], { ...request });
  assert.equal(result.reached, false);
  assert.equal(result.response.statusCode, 403);
  result = await middlewareChain([protect, adminOnly("HEAD_OFFICE")], { ...request });
  assert.equal(result.reached, false);
  assert.equal(result.response.statusCode, 403);
});

test("all canonical full-access roles can enter Executive Management", async () => {
  const roles = ["HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "SUPER_ADMIN", "ADMIN"];
  const middleware = [
    protect,
    adminOnly(...roles),
  ];
  for (const [index, role] of roles.entries()) {
    const user = role === "HEAD_OFFICE"
      ? ho
      : await User.create({
          fullName: `${role} Executive`,
          phone: `0810000000${index}`,
          email: `${role.toLowerCase()}@svp.test`,
          password: "StrongPass1!",
          role,
        });
    const token = jwt.sign({ id: user._id, authTokenVersion: 0 }, process.env.JWT_SECRET);
    const result = await middlewareChain(middleware, {
      headers: { authorization: `Bearer ${token}` },
      originalUrl: "/api/svp",
      url: "/api/svp",
    });
    assert.equal(result.reached, true, `${role} should reach Executive Management`);
  }

  const staff = await User.create({
    fullName: "Unauthorized Staff",
    phone: "08199999999",
    email: "unauthorized@svp.test",
    password: "StrongPass1!",
    role: "STAFF",
  });
  const token = jwt.sign({ id: staff._id, authTokenVersion: 0 }, process.env.JWT_SECRET);
  const denied = await middlewareChain(middleware, {
    headers: { authorization: `Bearer ${token}` },
    originalUrl: "/api/svp",
    url: "/api/svp",
  });
  assert.equal(denied.reached, false);
  assert.equal(denied.response.statusCode, 403);
});

test("canonical scopes map safely and deny unsupported domains by default", async () => {
  for (const scope of [{ type: "GLOBAL" }, { type: "REGION", region: "West" }, { type: "STATE", state: "Lagos" }, { type: "BRANCHES", branchIds: [branch._id] }, { type: "DEPARTMENT", department: "OPERATIONS" }, { type: "PRODUCTS", products: ["AIRTIME"] }, { type: "CUSTOM", filters: { branchIds: [branch._id] } }]) assert.ok(normalizeScope(scope).type);
  assert.deepEqual(await filterFor({ type: "PRODUCTS", products: ["AIRTIME"] }, "branch"), { _id: { $exists: false } });
  assert.deepEqual(await filterFor({ type: "DEPARTMENT", department: "OPERATIONS" }, "branch"), { _id: { $exists: false } });
});

test("scope isolation, command metrics, filters and performance use live records", async () => {
  const customer = await User.create({ fullName: "Lagos Customer", phone: "08000000005", password: "StrongPass1!", state: "Lagos", role: "CUSTOMER" });
  const staff = await User.create({ fullName: "Scoped Staff", phone: "08000000006", password: "StrongPass1!", isStaff: true, department: "OPERATIONS", branchId: branch._id, role: "STAFF" });
  await Transaction.create({ reference: "SVP-TX-1", customerId: customer._id, agentId: staff._id, branchId: branch._id, serviceType: "AIRTIME", amount: 300, servicepayProfit: 20, status: "SUCCESSFUL" });
  await Transaction.create({ reference: "OTHER-TX", customerId: customer._id, serviceType: "DATA", amount: 50, status: "PENDING" });
  assert.equal(first.svpScope.type, "BRANCHES");
  assert.equal(await Transaction.countDocuments(await filterFor(first.svpScope, "transaction")), 1);
  let response = await invoke(svp.metrics, req(first)); assert.equal(response.body.data.transactions.reduce((total, row) => total + row.value, 0), 300);
  response = await invoke(svp.transactions, req(first, {}, {}, { reference: "SVP-TX", customer: String(customer._id), branch: String(branch._id), staff: String(staff._id), status: "SUCCESSFUL", serviceType: "AIRTIME", from: "2020-01-01", to: "2030-01-01", page: "1", limit: "10" })); assert.equal(response.body.data.items.length, 1);
  response = await invoke(svp.transactions, req(first, {}, {}, { rider: String(customer._id) })); assert.equal(response.statusCode, 400);
  response = await invoke(svp.staffPerformance, req(first)); assert.equal(response.body.data[0].volume, 1);
  response = await invoke(svp.branchPerformance, req(first)); assert.equal(response.body.data[0].value, 300);
  response = await invoke(svp.liveOperations, req(first)); assert.equal(response.body.data.transactions.pending.value, 0); assert.equal(response.body.data.deliveries.available, true); assert.equal(response.body.data.pendingRiders.available, true); assert.equal(response.body.data.pendingEmpowerment.available, true);
  response = await invoke(svp.metrics, req(second)); assert.equal(response.body.data.transactions.length, 0);
});

test("auth payload fields, stale token revocation and admin isolation are enforced", async () => {
  const token = jwt.sign({ id: first._id, authTokenVersion: first.authTokenVersion }, process.env.JWT_SECRET);
  const request = { headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/svp/me/metrics", url: "/api/svp/me/metrics" };
  let code; await protect(request, res(), () => { code = 200; }); assert.equal(code, 200); assert.equal(request.user.role, "SVP"); assert.equal(request.user.executiveId, "SVP-001"); assert.ok(request.user.svpScope);
  let response = await invoke(svp.status, req(ho, { status: "SUSPENDED" }, { id: first._id })); assert.equal(response.statusCode, 200); first = await User.findById(first._id).select("+authTokenVersion"); assert.equal(first.authTokenVersion, 1);
  response = await invoke(svp.status, req(ho, { status: "ACTIVE" }, { id: first._id })); assert.equal(response.statusCode, 200);
  response = await invoke(svp.resetPassword, req(ho, { password: "AnotherStrong1!" }, { id: first._id })); assert.equal(response.statusCode, 200); first = await User.findById(first._id).select("+authTokenVersion"); assert.equal(first.authTokenVersion, 2);
  response = await invoke(svp.revokeSessions, req(ho, {}, { id: first._id })); assert.equal(response.statusCode, 200); first = await User.findById(first._id).select("+authTokenVersion"); assert.equal(first.authTokenVersion, 3);
  const stale = { headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/svp/me/metrics", url: "" }; const staleRes = res(); await protect(stale, staleRes, () => {}); assert.equal(staleRes.statusCode, 401);
  const admin = { headers: { authorization: `Bearer ${jwt.sign({ id: first._id, authTokenVersion: 3 }, process.env.JWT_SECRET)}` }, originalUrl: "/api/admin/transactions", url: "" }; const adminRes = res(); await protect(admin, adminRes, () => {}); assert.equal(adminRes.statusCode, 403);
});

test("requested transaction filters can only narrow canonical SVP scopes", async () => {
  const otherBranch = await Branch.create({ code: "SVP02", name: "Other Branch", state: "Abuja", createdBy: ho._id });
  const outsider = await User.create({ fullName: "Outside Customer", phone: "08000000007", password: "StrongPass1!", state: "Abuja", zone: "North", role: "CUSTOMER" });
  const outsideStaff = await User.create({ fullName: "Outside Staff", phone: "08000000008", password: "StrongPass1!", isStaff: true, department: "FINANCE", branchId: otherBranch._id, role: "STAFF" });
  const rider = await User.create({ fullName: "Outside Rider", phone: "08000000009", password: "StrongPass1!", state: "Abuja", branchId: otherBranch._id, role: "DELIVERY_RIDER" });
  await Transaction.create({ reference: "OUTSIDE-TX", customerId: outsider._id, agentId: outsideStaff._id, branchId: otherBranch._id, serviceType: "DATA", amount: 900, status: "SUCCESSFUL" });
  await Transaction.create({ reference: "RIDER-TX", customerId: rider._id, agentId: outsideStaff._id, branchId: otherBranch._id, serviceType: "DATA", amount: 100, status: "SUCCESSFUL" });
  const attempts = [
    [{ type: "REGION", region: "West" }, { customer: String(outsider._id) }],
    [{ type: "STATE", state: "Lagos" }, { branch: String(otherBranch._id) }],
    [{ type: "BRANCHES", branchIds: [branch._id] }, { branch: String(otherBranch._id) }],
    [{ type: "DEPARTMENT", department: "OPERATIONS" }, { staff: String(outsideStaff._id) }],
    [{ type: "PRODUCTS", products: ["AIRTIME"] }, { customer: String(outsider._id), serviceType: "DATA" }],
    [{ type: "CUSTOM", filters: { branchIds: [branch._id] } }, { rider: String(rider._id) }],
  ];
  for (const [scope, query] of attempts) {
    first.svpScope = scope;
    const response = await invoke(svp.transactions, req(first, {}, {}, { ...query, reference: query.rider ? "RIDER" : "OUTSIDE", page: "1", limit: "10" }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.items.length, 0, `${scope.type} scope was overridden`);
  }
  first.svpScope = { type: "GLOBAL" };
  const global = await invoke(svp.transactions, req(first, {}, {}, { branch: String(otherBranch._id), customer: String(outsider._id), staff: String(outsideStaff._id), reference: "OUTSIDE", page: "1", limit: "10" }));
  assert.equal(global.body.data.items.length, 1);
  const incompatible = await invoke(
    svp.transactions,
    req(first, {}, {}, {
      customer: String(outsider._id),
      rider: String(rider._id),
      page: "1",
      limit: "10",
    })
  );
  assert.equal(incompatible.statusCode, 400);
  assert.match(incompatible.body.message, /cannot be combined/i);
});

test("SVP report lifecycle and audit/report visibility are isolated", async () => {
  first.mustChangePassword = false; await first.save({ validateBeforeSave: false });
  let response = await invoke(svp.createReport, req(first, { type: "DAILY", title: "Daily report" })); const report = response.body.data;
  response = await invoke(svp.updateReport, req(first, { summary: "Updated" }, { id: report._id })); assert.equal(response.statusCode, 200);
  response = await invoke(svp.submitReport, req(first, {}, { id: report._id })); assert.equal(response.body.data.status, "SUBMITTED");
  for (const status of ["UNDER_REVIEW", "ACKNOWLEDGED", "ACTION_REQUIRED", "RESOLVED", "CLOSED"]) { response = await invoke(svp.reviewReport, req(ho, { status, comment: `Review ${status}` }, { id: report._id })); assert.equal(response.body.data.status, status); }
  response = await invoke(svp.listReports, req(second)); assert.equal(response.body.data.length, 0);
  response = await invoke(svp.headOfficeReports, req(ho)); assert.ok(response.body.data.some((x) => String(x._id) === String(report._id)));
  response = await invoke(svp.headOfficeReport, req(ho, {}, { id: report._id })); assert.equal(response.statusCode, 200);
  response = await invoke(svp.audit, req(first)); assert.ok(response.body.data.every((x) => String(x.actorId) === String(first._id) || String(x.targetUserId) === String(first._id)));
  response = await invoke(svp.headOfficeAudit, req(ho)); assert.ok(response.body.data.length > 0);
  assert.ok(await SVPReport.exists({ _id: report._id })); assert.ok(await Audit.exists({ action: "SVP_REPORT_REVIEWED" }));
});