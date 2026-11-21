const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(key => process.env[key])) {
  throw new Error("Refusing ambient database credentials; this suite is disposable-only.");
}
const User = require("../models/user.model");
const Role = require("../models/role.model");
const Audit = require("../models/adminAuditLog.model");
const provider = require("../services/securewave.service");
let dispatch, providerCalls = 0;
provider.generateVirtualAccount = async body => {
  providerCalls++;
  if (!dispatch) throw new Error("Live provider access is prohibited in this test.");
  return dispatch(body);
};
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const accounts = require("../controllers/adminVirtualAccount.controller");
const directory = require("../controllers/adminCustomer360.controller");
const staff = require("../controllers/operationsStaff.controller");
const jobs = require("../services/operationsVirtualAccountJobs.service");
const jobController = require("../controllers/operationsVirtualAccountJobs.controller");
const { provision } = require("../scripts/provisionOperationsVirtualAccountJobs");
let mongo, admin, operator, support, opsRole, supportRole, sequence = 100;
const identity = (fullName, role = "CUSTOMER", extra = {}) => {
  const n = ++sequence;
  return { fullName, role, phone: `080${String(n).padStart(8, "0")}`,
    email: `fixture-${n}@example.invalid`, password: "SandboxOnlyPassword123!",
    status: "ACTIVE", ...extra };
};
async function context(user, body = {}, params = {}, query = {}) {
  const req = { user, body, params, query, method: "TEST", originalUrl: "/sandbox/operations-control-centre" };
  const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let accepted = false;
  await loadStaffRole(req, res, () => { accepted = true; });
  assert.equal(accepted, true);
  return { req, res };
}
async function invoke(fn, user = admin, body = {}, params = {}, query = {}) {
  const { req, res } = await context(user, body, params, query);
  await fn(req, res); return res;
}
const confirmed = extra => ({ requestId: randomUUID(), reason: "Authorized disposable integration test",
  confirmed: true, ...extra });
const customer = extra => User.create(identity("Disposable Customer", "CUSTOMER", {
  walletBalance: 6543.21, totalTransactions: 8, totalEarnings: 17, ...extra,
}));
const newJob = async (users, actor = admin) => {
  const { req } = await context(actor, confirmed({ mode: "SELECTED", customerIds: users.map(u => String(u._id)) }));
  return jobs.createJob(req);
};
const success = () => ({ success: true, data: { account_number: `99${String(++sequence).padStart(8, "0")}`,
  account_name: "Disposable Customer", bank_name: "Sandbox Bank", bank_code: "001" } });
const batch = () => jobs.runBatch({ delay: async () => {} });

test.before(async () => {
  process.env.JWT_SECRET = "isolated-operations-control-centre-not-production";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 },
    instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Role.init(), Audit.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async t => {
  dispatch = success; providerCalls = 0;
  await User.deleteMany({});
  await Role.deleteMany({});
  if (!await jobs.storageReady() && !t.name.startsWith("import never provisions")) await provision({ apply: true });
  if (await jobs.storageReady()) await jobs.Job.deleteMany({});
  opsRole = await Role.create({ name: "OPERATIONS_MANAGER", displayName: "Operations Manager",
    department: "OPERATIONS", hierarchyLevel: 20, scopeType: "GLOBAL", status: "ACTIVE",
    permissions: ["operations.workspace.view", "customer360.view", "operations.staff.manage",
      "operations.virtual_accounts.view", "operations.virtual_accounts.generate", "operations.virtual_accounts.bulk"] });
  supportRole = await Role.create({ name: "CUSTOMER_SUPPORT", displayName: "Customer Support",
    department: "CUSTOMER_SUPPORT", hierarchyLevel: 25, scopeType: "GLOBAL", status: "ACTIVE",
    permissions: ["support.workspace.view", "support.view", "support.assign", "support.resolve"] });
  admin = await User.create(identity("Disposable Head Office", "HEAD_OFFICE"));
  operator = await User.create(identity("Disposable Operations", "STAFF", {
    isStaff: true, staffRoleId: opsRole._id, department: "OPERATIONS",
  }));
  support = await User.create(identity("Disposable Support", "STAFF", {
    isStaff: true, staffRoleId: supportRole._id, department: "CUSTOMER_SUPPORT",
  }));
});

test("import never provisions job storage; explicit additive provisioning is idempotent", async () => {
  assert.equal(await jobs.storageReady(), false);
  const { req } = await context(admin, confirmed({ mode: "ALL", customerIds: [] }));
  await assert.rejects(jobs.createJob(req), error => error.statusCode === 503);
  assert.equal(await jobs.storageReady(), false);
  const before = await User.find({}).lean();
  assert.equal((await provision()).applied, false);
  assert.equal((await provision({ apply: true })).ready, true);
  assert.equal((await provision({ apply: true })).ready, true);
  assert.deepEqual(await User.find({}).lean(), before);
  assert.equal(providerCalls, 0);
});
test("summary reports existing and missing accounts without generating anything", async () => {
  await customer();
  await customer({ virtualAccount: { accountNumber: "0123456789", status: "ACTIVE" } });
  const res = await invoke(jobController.summary);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.totalCustomers, 2);
  assert.equal(res.body.data.withoutAccounts, 1);
  assert.equal(res.body.data.storageReady, true);
  assert.equal(providerCalls, 0);
});
test("directory combines status/account/search filters and returns existing profile IDs", async () => {
  const fresh = await customer();
  await customer({ status: "SUSPENDED", virtualAccount: { accountNumber: "0123456789", status: "ACTIVE" } });
  const res = await invoke(directory.directory, operator, {}, {}, { status: "ACTIVE", account: "WITHOUT", q: "Disposable" });
  assert.equal(res.code, 200); assert.equal(res.body.data.pagination.total, 1);
  assert.equal(res.body.data.items[0].id, String(fresh._id));
  assert.equal(res.body.data.items[0].eligibility.canGenerate, true);
  assert.equal(Object.hasOwn(res.body.data.items[0], "walletBalance"), false);
});
test("directory fails closed for unsupported or incomplete scopes", async () => {
  const { req, res } = await context(operator);
  req.staffAccess.scope = { type: "STATE", zone: "North West" };
  await directory.directory(req, res); assert.equal(res.code, 403);
});
test("Support cannot access generation even with a leaked generation permission", async () => {
  supportRole.permissions.push("operations.virtual_accounts.view", "operations.virtual_accounts.generate",
    "operations.virtual_accounts.bulk", "operations.workspace.view");
  await supportRole.save();
  const target = await customer();
  assert.equal((await invoke(accounts.generate, support, { requestId: randomUUID(), reason: "Blocked support test" },
    { id: String(target._id) })).code, 403);
  assert.equal((await invoke(jobController.summary, support)).code, 403);
  assert.equal(providerCalls, 0);
});
test("individual explicit Operations generation preserves wallet and financial counters", async () => {
  const target = await customer();
  const before = await User.findById(target._id).lean();
  const res = await invoke(accounts.generate, operator, { requestId: randomUUID(), reason: "Authorized operator fixture" },
    { id: String(target._id) });
  assert.equal(res.code, 201); assert.equal(providerCalls, 1);
  const after = await User.findById(target._id).lean();
  for (const key of ["walletBalance", "totalTransactions", "totalEarnings", "phone", "email"]) assert.deepEqual(after[key], before[key]);
});
test("bulk intent UUID is idempotent and conflicting intents are rejected", async () => {
  const target = await customer();
  const { req } = await context(admin, confirmed({ mode: "SELECTED", customerIds: [String(target._id)] }));
  const [a, b] = await Promise.all([jobs.createJob(req), jobs.createJob(req)]);
  assert.equal(a.id, b.id); assert.equal(await jobs.Job.countDocuments({ kind: "JOB" }), 1);
  req.body.reason = "A different approved fixture reason";
  await assert.rejects(jobs.createJob(req), error => error.statusCode === 409);
  assert.equal(providerCalls, 0);
});
test("concurrent workers cannot generate duplicate accounts", async () => {
  const target = await customer(); const job = await newJob([target]);
  await Promise.all([batch(), batch()]);
  assert.equal(providerCalls, 1);
  const stored = await jobs.Job.findById(job.id).lean();
  assert.equal(stored.status, "COMPLETED"); assert.equal(stored.successful, 1);
  assert.equal(await jobs.Job.countDocuments({ kind: "ITEM" }), 1);
});
test("all-customer jobs retain existing accounts and cannot replay historical uncertain attempts", async () => {
  const active = await customer({ virtualAccount: { accountNumber: "0123456789", status: "ACTIVE" } });
  await customer({ virtualAccount: { status: "FAILED", failureReason: "HISTORICAL_UNKNOWN" } });
  await customer();
  const original = (await User.findById(active._id).lean()).virtualAccount;
  const { req } = await context(admin, confirmed({ mode: "ALL", customerIds: [] }));
  const job = await jobs.createJob(req); await batch();
  const stored = await jobs.Job.findById(job.id).lean();
  assert.equal(stored.status, "COMPLETED"); assert.equal(stored.successful, 2);
  assert.equal(stored.pending, 1); assert.equal(providerCalls, 1);
  assert.deepEqual((await User.findById(active._id).lean()).virtualAccount, original);
});
test("whitelist rejection pauses the batch after one provider request", async () => {
  dispatch = async () => { throw Object.assign(new Error("This IP address 203.0.113.25 is not whitelisted."),
    { statusCode: 404, providerResponse: { success: false, code: "IP_NOT_WHITELISTED" } }); };
  const users = [await customer(), await customer()];
  const job = await newJob(users); await batch(); await batch();
  const stored = await jobs.Job.findById(job.id).lean();
  assert.equal(stored.status, "PAUSED"); assert.equal(stored.failed, 1);
  assert.equal(providerCalls, 1);
});
test("unknown provider response remains pending and never triggers automatic retry", async () => {
  dispatch = async () => ({ success: true, data: { message: "Unknown incomplete provider response" } });
  const target = await customer(); const job = await newJob([target]);
  await batch(); await batch();
  assert.equal((await jobs.Job.findById(job.id).lean()).pending, 1);
  assert.equal((await jobs.Job.findById(job.id).lean()).status, "PAUSED");
  assert.equal(providerCalls, 1);
});
test("revoking a job owner's grant pauses processing before provider dispatch", async () => {
  const target = await customer(); const job = await newJob([target], operator);
  opsRole.permissions = opsRole.permissions.filter(p => p !== "operations.virtual_accounts.generate");
  await opsRole.save();
  await assert.rejects(batch(), error => error.statusCode === 403);
  assert.equal((await jobs.Job.findById(job.id).lean()).pauseReason, "ACTOR_AUTHORIZATION_REQUIRED");
  assert.equal(providerCalls, 0);
});
test("generate without bulk cannot submit even a single-customer background job", async () => {
  opsRole.permissions = opsRole.permissions.filter(p => p !== "operations.virtual_accounts.bulk");
  await opsRole.save();
  const res = await invoke(jobController.create, operator, confirmed({ mode: "SELECTED", customerIds: [String((await customer())._id)] }));
  assert.equal(res.code, 403); assert.equal(providerCalls, 0);
});
test("safe Support creation reuses password hashing and mandatory password setup", async () => {
  const data = identity("New Support", "STAFF");
  const res = await invoke(staff.create, operator, { fullName: data.fullName, phone: data.phone,
    email: data.email, password: data.password, confirmed: true, reason: "Approved disposable support appointment" });
  assert.equal(res.code, 201);
  const stored = await User.findOne({ phone: data.phone }).select("+password").lean();
  assert.equal(String(stored.staffRoleId), String(supportRole._id));
  assert.equal(stored.mustChangePassword, true);
  assert.notEqual(stored.password, data.password);
  assert.equal(JSON.stringify(res.body).includes(data.password), false);
});
test("delegation cannot grant a Support role with financial permissions", async () => {
  supportRole.permissions.push("operations.refund"); await supportRole.save();
  const data = identity("Blocked Support");
  const res = await invoke(staff.create, operator, { fullName: data.fullName, phone: data.phone,
    email: data.email, password: data.password, confirmed: true, reason: "Rejected privileged role fixture" });
  assert.equal(res.code, 409); assert.equal(await User.countDocuments({ phone: data.phone }), 0);
});
test("Support and scoped managers cannot reach subordinate staff administration", async () => {
  assert.equal((await invoke(staff.options, support)).code, 403);
  opsRole.scopeType = "ZONE"; await opsRole.save();
  operator.zone = "North West"; await operator.save();
  assert.equal((await invoke(staff.options, operator)).code, 403);
});
test("Operations cannot modify a peer or grant another role through Support update", async () => {
  const res = await invoke(staff.update, operator, {
    fullName: "Peer tampering", confirmed: true, reason: "Rejected cross-role fixture",
  }, { staffId: String(admin._id) });
  assert.equal(res.code, 403);
  const injected = await invoke(staff.update, operator, {
    roleId: String(opsRole._id), confirmed: true, reason: "Rejected role escalation fixture",
  }, { staffId: String(support._id) });
  assert.equal(injected.code, 400);
});
test("Zonal creation uses canonical role, selected status and bounded permission profile", async () => {
  const data = identity("Read Only Zonal");
  const res = await invoke(staff.createZonal, operator, { fullName: data.fullName, phone: data.phone,
    email: data.email, password: data.password, zone: "North West", permissionProfile: "READ_ONLY",
    status: "SUSPENDED", confirmed: true, reason: "Approved disposable zonal appointment" });
  assert.equal(res.code, 201);
  const stored = await User.findOne({ phone: data.phone }).lean();
  assert.equal(stored.role, "ZONAL_MANAGER"); assert.equal(stored.zone, "North West");
  assert.equal(stored.status, "SUSPENDED"); assert.equal(stored.managementAccess, "READ_ONLY");
  assert.equal(stored.mustChangePassword, true);
  assert.equal(await Audit.countDocuments({ targetUserId: stored._id, action: "USER_CREATED" }), 1);
});
test("State Manager creation uses the selected active parent fence and records an audit", async () => {
  const parent = await User.create(identity("Disposable Zonal", "ZONAL_MANAGER", { zone: "North West" }));
  const data = identity("Disposable State");
  const res = await invoke(staff.createState, operator, { fullName: data.fullName, phone: data.phone,
    email: data.email, password: data.password, state: "Kano", zonalManagerId: String(parent._id),
    confirmed: true, reason: "Approved disposable state appointment" });
  assert.equal(res.code, 201);
  const stored = await User.findOne({ phone: data.phone }).lean();
  assert.equal(stored.role, "STATE_MANAGER"); assert.equal(stored.zone, parent.zone);
  assert.equal(stored.state, "Kano"); assert.equal(String(stored.zonalManagerId), String(parent._id));
  assert.equal(stored.mustChangePassword, true);
  assert.equal(await Audit.countDocuments({ targetUserId: stored._id, action: "USER_CREATED" }), 1);
});
test("inactive parents cannot receive a new State Manager", async () => {
  const parent = await User.create(identity("Inactive Zonal", "ZONAL_MANAGER", { zone: "North West", status: "SUSPENDED" }));
  const data = identity("Rejected State");
  const res = await invoke(staff.createState, operator, { fullName: data.fullName, phone: data.phone,
    email: data.email, password: data.password, state: "Kano", zonalManagerId: String(parent._id),
    confirmed: true, reason: "Rejected inactive parent fixture" });
  assert.ok(res.code >= 400); assert.equal(await User.countDocuments({ phone: data.phone }), 0);
});
test("expired worker leases retain an account created before progress was committed", async () => {
  const target = await customer();
  const { req } = await context(admin, confirmed({ mode: "ALL", customerIds: [] }));
  const job = await jobs.createJob(req);
  await User.updateOne({ _id: target._id }, { $set: {
    virtualAccount: { accountNumber: "0123456789", bankName: "Sandbox Bank", status: "ACTIVE" },
  } });
  await jobs.Job.updateOne({ _id: job.id }, { $set: {
    status: "RUNNING", leaseToken: "expired-sandbox-lease", leaseUntil: new Date(0),
  } });
  await batch();
  const stored = await jobs.Job.findById(job.id).lean();
  assert.equal(stored.status, "COMPLETED"); assert.equal(stored.successful, 1);
  assert.equal(providerCalls, 0);
});
test("view-only Operations sees account status without an enabled generate action", async () => {
  opsRole.permissions = opsRole.permissions.filter(value => value !== "operations.virtual_accounts.generate");
  await opsRole.save();
  const target = await customer();
  const res = await invoke(accounts.get, operator, {}, { id: String(target._id) });
  assert.equal(res.code, 200); assert.equal(res.body.data.eligibility.canGenerate, false);
  assert.equal(providerCalls, 0);
});
test("read-only Zonal permissions cannot bypass legacy protected writes", async () => {
  const jwt = require("jsonwebtoken");
  const { protect } = require("../middleware/auth.middleware");
  const zonal = await User.create(identity("Read Only Manager", "ZONAL_MANAGER", {
    zone: "North West", managementAccess: "READ_ONLY",
  }));
  const token = jwt.sign({ id: String(zonal._id), authTokenVersion: 0 }, process.env.JWT_SECRET);
  const exercise = async (method, path) => {
    const req = { headers: { authorization: `Bearer ${token}` }, method, originalUrl: path };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let next = false; await protect(req, res, () => { next = true; }); return { next, res };
  };
  assert.equal((await exercise("GET", "/api/management/state-managers")).next, true);
  const rejected = await exercise("POST", "/api/management/state-managers");
  assert.equal(rejected.res.code, 403); assert.equal(rejected.res.body.code, "MANAGEMENT_READ_ONLY");
  assert.equal((await exercise("PUT", "/api/auth/change-password")).next, true);
  // Test the actual middleware-derived permission list rather than inventing
  // grants. Direct role scope must remain zone-bound.
  const { req } = await context(zonal);
  assert.equal(req.staffAccess.scope.type, "ZONE");
  assert.equal(req.staffAccess.scope.zone, "North West");
  assert.ok(req.staffAccess.permissions.every(value => value.endsWith(".view")));
});
test("executive read requires the explicit GLOBAL Operations grant without changing actor identity", async () => {
  const dashboard = require("../services/adminDashboard.service");
  assert.equal((await invoke(dashboard.getOperationsExecutiveDashboard, operator)).code, 403);
  opsRole.permissions.push("operations.executive.view"); await opsRole.save();
  await customer();
  const { req, res } = await context(operator, {}, {}, { range: "week" });
  await dashboard.getOperationsExecutiveDashboard(req, res);
  assert.equal(res.code, 200); assert.equal(res.body.success, true);
  assert.equal(req.user.role, "STAFF"); assert.equal(req.query.range, "week");
  assert.equal((await invoke(dashboard.getOperationsExecutiveDashboard, support)).code, 403);
  assert.equal((await invoke(dashboard.getOperationsExecutiveDashboard, operator, {}, {}, { range: "undocumented" })).code, 400);
});
test("confirmed manager-access changes revoke sessions without changing balances or hierarchy", async () => {
  const target = await User.create(identity("Managed Zonal", "ZONAL_MANAGER", { zone: "North West", walletBalance: 123.45 }));
  const res = await invoke(staff.updateManagerAccess, operator, { confirmed: true,
    reason: "Approved read-only access adjustment", permissionProfile: "READ_ONLY", status: "ACTIVE" },
    { id: String(target._id) });
  assert.equal(res.code, 200);
  const stored = await User.findById(target._id).select("+authTokenVersion").lean();
  assert.equal(stored.managementAccess, "READ_ONLY"); assert.equal(stored.authTokenVersion, 1);
  assert.equal(stored.walletBalance, 123.45); assert.equal(stored.zone, "North West");
  assert.equal(await Audit.countDocuments({ targetUserId: target._id, action: "USER_ROLE_UPDATED" }), 1);
  const restore = await invoke(staff.updateManagerAccess, operator, { confirmed: true,
    reason: "Approved standard access restoration", permissionProfile: "STANDARD", status: "ACTIVE" },
    { id: String(target._id) });
  assert.equal(restore.code, 200);
  assert.equal((await User.findById(target._id).lean()).managementAccess, "STANDARD");
});
test("manager-access endpoint refuses staff peers and injected financial changes", async () => {
  const body = { confirmed: true, reason: "Invalid privilege escalation fixture", permissionProfile: "STANDARD", status: "ACTIVE" };
  assert.equal((await invoke(staff.updateManagerAccess, operator, body, { id: String(admin._id) })).code, 404);
  assert.equal((await invoke(staff.updateManagerAccess, operator, { ...body, walletBalance: 0 }, { id: String(admin._id) })).code, 400);
  assert.equal((await invoke(staff.updateManagerAccess, support, body, { id: String(admin._id) })).code, 403);
});
test("bounded Support management works at the actual production role level", async () => {
  const params = { staffId: String(support._id) };
  const edited = await invoke(staff.update, operator, { fullName: "Updated Disposable Support",
    confirmed: true, reason: "Approved disposable support identity edit" }, params);
  assert.equal(edited.code, 200);
  const suspended = await invoke(staff.status, operator, { status: "SUSPENDED",
    confirmed: true, reason: "Approved disposable support suspension" }, params);
  assert.equal(suspended.code, 200);
  const stored = await User.findById(support._id).select("+authTokenVersion").lean();
  assert.equal(stored.fullName, "Updated Disposable Support"); assert.equal(stored.status, "SUSPENDED");
  assert.equal(stored.authTokenVersion, 1); assert.equal(stored.walletBalance, support.walletBalance);
  const active = await invoke(staff.status, operator, { status: "ACTIVE",
    confirmed: true, reason: "Approved disposable support reactivation" }, params);
  assert.equal(active.code, 200);
});
test("an audit failure rolls back a scoped Support status change and session revocation", async () => {
  const original = Audit.create;
  try {
    Audit.create = async () => { throw new Error("Disposable audit failure"); };
    const result = await invoke(staff.status, operator, { status: "SUSPENDED", confirmed: true,
      reason: "Approved disposable rollback verification" }, { staffId: String(support._id) });
    assert.equal(result.code, 500);
  } finally { Audit.create = original; }
  const unchanged = await User.findById(support._id).select("+authTokenVersion").lean();
  assert.equal(unchanged.status, "ACTIVE"); assert.equal(unchanged.authTokenVersion, 0);
});
