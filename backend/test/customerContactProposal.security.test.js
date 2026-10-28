const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const email = require("../services/email.service");
let notices = [];
email.sendEmail = async message => { notices.push(message); return { success: true }; };
const controller = require("../controllers/customerContactProposal.controller");
const profile = require("../controllers/customerProfile.controller");
const password = "IsolatedProposalPassword123!";
let mongo, customer, admin, other;
const request = (extra = {}) => ({ phone: "08060000099", reason: "Customer requested a pending correction",
  currentPassword: password, expectedProposalId: null, ...extra });
async function invoke(method, body = {}, actor = admin, target = customer) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await controller[method]({ user: actor ? { _id: actor._id, role: actor.role } : null,
    params: { id: String(target._id) }, body, method: "PUT", originalUrl: "/admin/profile/contact-proposal",
    staffAccess: { isHeadOffice: actor?.role === "HEAD_OFFICE", permissions: ["*"] } }, res);
  return res;
}
async function snapshot() {
  const user = await User.findById(customer._id).select("+authTokenVersion").lean();
  delete user.updatedAt;
  return user;
}
test.before(async () => {
  for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
    assert.equal(process.env[key], undefined, "Ambient database forbidden");
  }
  process.env.JWT_SECRET = "disposable-proposal-proof-secret";
  process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED = "false";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Audit.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Audit.collection.deleteMany({})]);
  notices = [];
  [customer, admin, other] = await User.create([
    { fullName: "Pending QA Customer", phone: "08060000001", email: "pending.customer@example.invalid",
      password, role: "CUSTOMER", status: "ACTIVE", address: "Existing address",
      state: "Kano", lga: "Nassarawa", zone: "North West", walletBalance: 12500,
      walletHeldBalance: 1500, emailVerified: true, phoneVerified: true },
    { fullName: "Pending QA Head Office", phone: "08060000002", email: "pending.admin@example.invalid",
      password, role: "HEAD_OFFICE", status: "ACTIVE" },
    { fullName: "Other QA Customer", phone: "08060000003", email: "other.customer@example.invalid",
      password, role: "CUSTOMER", status: "ACTIVE" },
  ]);
});
test("unauthenticated, customer and STAFF wildcard requests are rejected", async () => {
  assert.equal((await invoke("put", request(), null)).code, 401);
  assert.equal((await invoke("get", {}, customer)).code, 403);
  assert.equal((await invoke("put", request(), { ...admin.toObject(), role: "STAFF" })).code, 403);
});
test("reason, password, current proposal version and allowed fields are required", async () => {
  for (const body of [
    request({ reason: "" }), request({ currentPassword: "" }),
    { phone: "08060000099", reason: "Valid reason", currentPassword: password },
    request({ emailVerified: true }), request({ walletBalance: 999999 }),
  ]) assert.equal((await invoke("put", body)).code, 400);
  assert.equal((await invoke("put", request({ currentPassword: "incorrect" }))).code, 401);
  assert.equal(await Audit.countDocuments(), 0);
});
test("pending proposal normalizes values without changing any active customer field", async () => {
  const before = await snapshot();
  const result = await invoke("put", request({ phone: "+234 806 000 0099", email: " NEW.OWNER@EXAMPLE.INVALID " }));
  assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.proposal.status, "PENDING_VERIFICATION");
  assert.equal(result.body.data.proposal.proposedPhone, "08060000099");
  assert.equal(result.body.data.proposal.proposedEmail, "new.owner@example.invalid");
  assert.deepEqual(await snapshot(), before);
  assert.equal((await User.findById(customer._id)).profileContactProposal, undefined);
  const record = await Audit.findOne({ action: "PROFILE_CONTACT_PROPOSED" }).lean();
  assert.deepEqual(record.previousData, record.newData);
  assert.equal(record.metadata.ownershipVerified, false);
  assert.equal(record.metadata.activeContactsChanged, false);
  assert.equal(record.metadata.pendingContact.status, "PENDING_VERIFICATION");
  assert.equal(JSON.stringify(record).includes(password), false);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].to, customer.email);
  assert.equal(notices[0].text.includes("new.owner"), false);
});
test("active duplicate contacts and malformed new contacts are rejected", async () => {
  for (const body of [request({ phone: "+2348060000003" }), request({ email: "OTHER.CUSTOMER@EXAMPLE.INVALID" })]) {
    assert.equal((await invoke("put", body)).code, 409);
  }
  assert.equal((await invoke("put", request({ phone: "123" }))).code, 400);
  assert.equal((await invoke("put", request({ email: "not-an-email" }))).code, 400);
  assert.equal(await Audit.countDocuments(), 0);
});
test("equivalent contacts are not proposed as new values", async () => {
  assert.equal((await invoke("put", request({ phone: "+2348060000001" }))).code, 400);
  assert.equal((await invoke("put", request({ phone: customer.phone, email: customer.email.toUpperCase() }))).code, 400);
});
test("parallel first writes cannot silently overwrite each other", async () => {
  const outcomes = await Promise.all([
    invoke("put", request()), invoke("put", request({ phone: "08060000098" })),
  ]);
  assert.deepEqual(outcomes.map(r => r.code).sort(), [200, 409]);
  assert.equal(await Audit.countDocuments({ action: "PROFILE_CONTACT_PROPOSED" }), 1);
});
test("replacement and withdrawal require the latest version, reauthentication and audit", async () => {
  const before = await snapshot();
  const created = await invoke("put", request());
  const first = created.body.data.proposal.id;
  assert.equal((await invoke("put", request({ phone: "08060000098" }))).code, 409);
  const replaced = await invoke("put", request({ phone: "08060000098", expectedProposalId: first }));
  assert.equal(replaced.code, 200);
  const second = replaced.body.data.proposal.id;
  assert.notEqual(first, second);
  assert.equal((await invoke("withdraw", { currentPassword: password, reason: "Withdraw requested", expectedProposalId: first })).code, 409);
  const withdrawn = await invoke("withdraw", { currentPassword: password, reason: "Withdraw requested", expectedProposalId: second });
  assert.equal(withdrawn.code, 200);
  assert.equal(withdrawn.body.data.proposal, null);
  assert.equal((await invoke("get")).body.data.proposal, null);
  assert.equal(await Audit.countDocuments({ action: "PROFILE_CONTACT_WITHDRAWN" }), 1);
  assert.deepEqual(await snapshot(), before);
});
test("changed active contacts make a proposal stale without activating it", async () => {
  await invoke("put", request());
  await User.updateOne({ _id: customer._id }, { $set: { email: "independently.changed@example.invalid" } });
  const state = await invoke("get");
  assert.equal(state.body.data.proposal.status, "STALE");
  assert.equal((await User.findById(customer._id)).phone, customer.phone);
});
test("audit failure rolls back the proposal", async () => {
  const original = Audit.create;
  Audit.create = async () => { throw new Error("Isolated audit unavailable"); };
  try { assert.equal((await invoke("put", request())).code, 500); }
  finally { Audit.create = original; }
  assert.equal((await invoke("get")).body.data.proposal, null);
});
test("persistent password-check cap survives controller state", async () => {
  await User.updateOne({ _id: admin._id }, { $set: { profileContactProposalRate: { count: 20, until: new Date(Date.now() + 600000) } } });
  assert.equal((await invoke("put", request())).code, 429);
});
test("ordinary geographic edits and equivalent echoed contacts need no OTP", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { phone: "+2348060000001" } });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await profile.updateAdmin({
    user: { _id: admin._id, role: "HEAD_OFFICE" }, params: { id: String(customer._id) },
    body: { fullName: "Corrected display name", address: "Corrected address", state: "Kaduna", lga: "Chikun", zone: "North West",
      phone: "08060000001", email: customer.email.toUpperCase(), reason: "Correct geographic details" },
    staffAccess: { isHeadOffice: true, permissions: [] },
  }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const saved = await User.findById(customer._id);
  assert.equal(saved.phone, "+2348060000001");
  assert.equal(saved.email, customer.email);
  assert.equal(saved.state, "Kaduna");
  assert.equal(saved.lga, "Chikun");
});
test("customer OTP gate remains closed while pending proposals remain permitted", async () => {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await profile.updateSelf({ user: { _id: customer._id, role: "CUSTOMER" },
    body: { email: "unauthorized@example.invalid" } }, res);
  assert.equal(res.code, 503);
  assert.equal((await invoke("put", request())).code, 200);
  assert.equal((await User.findById(customer._id)).email, customer.email);
});
