const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const email = require("../services/email.service");
const sms = require("../services/logisticsSms.service");
let sent, deliver = true, mongo, customer, admin, other;
email.sendEmail = async body => {
  sent.push({ channel: "email", to: body.to, code: body.text.match(/\b\d{6}\b/)?.[0] });
  return { success: deliver };
};
sms.sendDeliveryOtp = async body => {
  sent.push({ channel: "phone", to: body.phone, code: body.code });
  return { sent: deliver };
};
const c = require("../controllers/customerProfile.controller");
const auth = require("../controllers/auth.controller");
const password = "OnlySandbox123!";
async function invoke(method, body = {}, actor = customer, target = customer, query = {}) {
  const res = { code: 200, body: null, status(n) { this.code = n; return this; }, json(b) { this.body = b; return this; } };
  await c[method]({ user: actor ? { _id: actor._id, role: actor.role } : null,
    params: { id: target?._id?.toString() }, body, query, method: "PUT",
    staffAccess: actor?.role === "HEAD_OFFICE" ? { isHeadOffice: true, permissions: ["*"] } : { permissions: [] } }, res);
  return res;
}
async function challenge(field = "email", value = "changed@example.invalid", actor = customer) {
  const r = await invoke(actor.role === "HEAD_OFFICE" ? "requestAdminContact" : "requestSelfContact",
    { field, value, currentPassword: password, reason: "Customer approved correction" }, actor);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  return { challengeId: r.body.data.challengeId, code: sent.at(-2).code, approvalCode: sent.at(-1).code };
}
test.before(async () => {
  for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) assert.equal(process.env[key], undefined, "Ambient database forbidden.");
  process.env.JWT_SECRET = "sandbox-profile-proof-key";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Audit.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  // Explicit opt-in exercises the preserved future OTP flow in isolation only.
  process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED = "true";
  // Only the isolated disposable replica; production audit model stays immutable.
  await Promise.all([User.deleteMany({}), Audit.collection.deleteMany({})]); sent = []; deliver = true;
  [customer, admin, other] = await User.create([
    { fullName: "Sandbox Customer", phone: "08060000001", email: "customer@example.invalid", password, role: "CUSTOMER", status: "ACTIVE",
      walletBalance: 4321.5, referralCode: "SANDBOXCODE", kycVerified: true,
      virtualAccount: { accountNumber: "0123456789", accountName: "Sandbox Customer", bankName: "Sandbox Bank", status: "ACTIVE" } },
    { fullName: "Sandbox Admin", phone: "08060000002", email: "admin@example.invalid", password, role: "HEAD_OFFICE", status: "ACTIVE" },
    { fullName: "Other Customer", phone: "08060000003", email: "other@example.invalid", password, role: "CUSTOMER", status: "ACTIVE" },
  ]);
});
test.afterEach(async () => {
  const u = await User.findById(customer._id);
  assert.equal(u.walletBalance, 4321.5); assert.equal(u.referralCode, "SANDBOXCODE");
  assert.equal(u.kycVerified, true); assert.equal(u.virtualAccount.accountNumber, "0123456789");
});
test("customer saves name and residential address on the same record and returns full profile", async () => {
  const r = await invoke("updateSelf", { fullName: "Corrected Customer", address: "10 Sandbox Street" });
  assert.equal(r.code, 200); assert.equal(r.body.user.walletBalance, 4321.5);
  assert.equal(r.body.user.address, "10 Sandbox Street"); assert.equal(r.body.data.requiresLogin, false);
  assert.equal(await User.countDocuments({}), 3);
  assert.equal(await Audit.countDocuments({ actorId: customer._id, action: "USER_PROFILE_UPDATED" }), 1);
});
test("Customer legacy PUT delegates to verified update instead of bypassing OTP", async () => {
  const res = { code: 200, status(n) { this.code = n; return this; }, json(b) { this.body = b; return this; } };
  await auth.updateProfile({ user: { _id: customer._id, role: "CUSTOMER" }, body: { email: "unverified@example.invalid" } }, res);
  assert.equal(res.code, 400); assert.equal((await User.findById(customer._id)).email, customer.email);
});
test("unauthenticated requests and staff self-service are rejected", async () => {
  assert.equal((await invoke("updateSelf", { fullName: "Intruder" }, null)).code, 401);
  assert.equal((await invoke("updateSelf", { fullName: "Intruder" }, admin)).code, 403);
});
test("customer cannot choose another target via request fields", async () => {
  assert.equal((await invoke("updateSelf", { userId: other._id, fullName: "Intruder" })).code, 400);
  assert.equal((await User.findById(other._id)).fullName, "Other Customer");
});
test("all protected financial and identity fields are rejected", async () => {
  for (const field of ["walletBalance", "walletHeldBalance", "kycVerified", "nin", "bvn", "virtualAccount", "role", "referralCode", "password", "transactionPin"]) {
    assert.equal((await invoke("updateSelf", { [field]: "tampered" })).code, 400, field);
  }
});
test("profile validation rejects invalid names, oversized address and objects", async () => {
  for (const body of [{ fullName: "" }, { fullName: {} }, { address: "x".repeat(501) }, { email: "bad" }, { phone: "123" }]) {
    assert.equal((await invoke("updateSelf", body)).code, 400);
  }
});
test("email change requires the correct current password before delivering anything", async () => {
  assert.equal((await invoke("requestSelfContact", { field: "email", value: "new@example.invalid", currentPassword: "incorrect" })).code, 401);
  assert.equal(sent.length, 0);
});
test("verification sends different destination and approval codes without exposing them", async () => {
  const r = await invoke("requestSelfContact", { field: "email", value: "new@example.invalid", currentPassword: password });
  assert.equal(r.code, 200); assert.equal(sent.length, 2);
  assert.equal(sent[0].to, "new@example.invalid"); assert.equal(sent[1].to, customer.email);
  assert.ok(!JSON.stringify(r.body).includes(sent[0].code));
  const u = await User.findById(customer._id).lean();
  assert.equal(u.profileContactChallenge, undefined);
  assert.equal(u.profileContactRate, undefined);
});
test("verified email change persists atomically, audits and revokes old sessions", async () => {
  const verification = await challenge();
  const r = await invoke("updateSelf", { email: "changed@example.invalid", contactVerifications: { email: verification } });
  assert.equal(r.code, 200); assert.equal(r.body.data.requiresLogin, true);
  const u = await User.findById(customer._id).select("+authTokenVersion +profileContactChallenge");
  assert.equal(u.email, "changed@example.invalid"); assert.equal(u.emailVerified, true);
  assert.equal(u.authTokenVersion, 1); assert.equal(u.profileContactChallenge, undefined);
  const log = await Audit.findOne({});
  assert.deepEqual(log.metadata.verifiedContactFields, ["email"]);
  assert.ok(!JSON.stringify(log).includes(verification.code));
  assert.ok(!JSON.stringify(log).includes("codeHash"));
});
test("verified Nigerian phone is normalized and both OTPs are required", async () => {
  const verification = await challenge("phone", "+234 806 000 0010");
  assert.equal(sent[0].channel, "phone");
  assert.equal(sent[1].channel, "email");
  const bad = await invoke("updateSelf", { phone: "08060000010", contactVerifications: { phone: { ...verification, approvalCode: "" } } });
  assert.equal(bad.code, 400);
  const good = await invoke("updateSelf", { phone: "+2348060000010", contactVerifications: { phone: verification } });
  assert.equal(good.code, 200); assert.equal(good.body.user.phone, "08060000010");
});
test("verification cannot be replayed", async () => {
  const v = await challenge();
  const body = { email: "changed@example.invalid", contactVerifications: { email: v } };
  assert.equal((await invoke("updateSelf", body)).code, 200);
  assert.equal((await invoke("updateSelf", { email: "different@example.invalid", contactVerifications: { email: v } })).code, 400);
});
test("changed destination invalidates an otherwise correct OTP", async () => {
  const v = await challenge();
  assert.equal((await invoke("updateSelf", { email: "different@example.invalid", contactVerifications: { email: v } })).code, 400);
});
test("expired verification fails closed", async () => {
  const v = await challenge();
  await User.updateOne({ _id: customer._id }, { $set: { "profileContactChallenge.expiresAt": new Date(0) } });
  assert.equal((await invoke("updateSelf", { email: "changed@example.invalid", contactVerifications: { email: v } })).code, 400);
});
test("five wrong guesses persist even though profile transaction rolls back", async () => {
  const v = await challenge();
  const wrong = { ...v, code: v.code === "000000" ? "111111" : "000000" };
  for (let i = 0; i < 5; i++) assert.equal((await invoke("updateSelf", { email: "changed@example.invalid", contactVerifications: { email: wrong } })).code, 400);
  assert.equal((await invoke("updateSelf", { email: "changed@example.invalid", contactVerifications: { email: v } })).code, 400);
  const stored = await User.findById(customer._id).select("+profileContactChallenge");
  assert.equal(stored.profileContactChallenge.attempts, 5);
});
test("OTP resend is bounded by persistent cooldown", async () => {
  await challenge();
  const r = await invoke("requestSelfContact", { field: "email", value: "again@example.invalid", currentPassword: password });
  assert.equal(r.code, 429); assert.equal(sent.length, 2);
});
test("hourly OTP request limit survives elapsed cooldown", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { profileContactRate: { lastSent: new Date(Date.now() - 61000), hour: new Date(), count: 5 } } });
  assert.equal((await invoke("requestSelfContact", { field: "email", value: "again@example.invalid", currentPassword: password })).code, 429);
  assert.equal(sent.length, 0);
});
test("delivery failure never changes contacts or leaves a usable challenge", async () => {
  deliver = false;
  const r = await invoke("requestSelfContact", { field: "phone", value: "08060000010", currentPassword: password });
  assert.equal(r.code, 503);
  const u = await User.findById(customer._id).select("+profileContactChallenge");
  assert.equal(u.phone, customer.phone); assert.equal(u.profileContactChallenge, undefined);
});
test("existing email and equivalent international phone aliases cannot be claimed", async () => {
  for (const [field, value] of [["email", "OTHER@EXAMPLE.INVALID"], ["phone", "+2348060000003"]]) {
    assert.equal((await invoke("requestSelfContact", { field, value, currentPassword: password })).code, 409);
  }
  assert.equal(sent.length, 0);
});
test("legacy administrator OTP proofs cannot bypass direct correction safeguards", async () => {
  const v = await challenge("email", "changed@example.invalid", admin);
  assert.equal(sent[1].to, customer.email);
  const body = { email: "changed@example.invalid", reason: "Customer approved correction", contactVerifications: { email: v } };
  assert.equal((await invoke("updateAdmin", body, admin)).code, 400);
  assert.equal(await Audit.countDocuments(), 0);
});
test("another actor cannot use a customer's valid challenge", async () => {
  const v = await challenge();
  const r = await invoke("updateAdmin", { email: "changed@example.invalid", reason: "Customer approved correction", contactVerifications: { email: v } }, admin);
  assert.equal(r.code, 400);
});
test("admin profile edits require reason and target must remain CUSTOMER", async () => {
  assert.equal((await invoke("updateAdmin", { fullName: "Updated" }, admin)).code, 400);
  assert.equal((await invoke("updateAdmin", { fullName: "Updated", reason: "Support correction" }, admin, admin)).code, 404);
});
test("non-Head Office cannot edit or read customer profile history", async () => {
  assert.equal((await invoke("updateAdmin", { fullName: "Updated", reason: "Support correction" }, other)).code, 403);
  assert.equal((await invoke("history", {}, other)).code, 403);
});
test("admin update is visible to customer and history records actor/time and changes", async () => {
  const r = await invoke("updateAdmin", { fullName: "Updated Customer", address: "25 Sandbox Road", reason: "Customer requested correction" }, admin);
  assert.equal(r.code, 200);
  const u = await User.findById(customer._id);
  assert.equal(auth.formatUser(u).address, "25 Sandbox Road");
  const h = await invoke("history", {}, admin);
  assert.equal(h.code, 200); assert.equal(h.body.data.total, 1);
  assert.equal(h.body.data.history[0].actorName, "Sandbox Admin");
  assert.ok(h.body.data.history[0].createdAt);
  assert.equal(h.body.data.history[0].previousData.fullName, "Sandbox Customer");
  assert.equal(h.body.data.history[0].newData.fullName, "Updated Customer");
});
test("audit failure rolls back the profile change", async () => {
  const create = Audit.create;
  Audit.create = async () => { throw new Error("simulated audit failure"); };
  try {
    assert.equal((await invoke("updateAdmin", { fullName: "Should rollback", reason: "Sandbox atomicity check" }, admin)).code, 500);
    assert.equal((await User.findById(customer._id)).fullName, "Sandbox Customer");
  } finally { Audit.create = create; }
});
test("contact challenge is invalidated by a concurrent session revocation", async () => {
  const v = await challenge();
  await User.updateOne({ _id: customer._id }, { $inc: { authTokenVersion: 1 } });
  assert.equal((await invoke("updateSelf", { email: "changed@example.invalid", contactVerifications: { email: v } })).code, 400);
});
test("email and phone cannot both change with one challenge", async () => {
  assert.equal((await invoke("updateSelf", { email: "new@example.invalid", phone: "08060000010" })).code, 400);
});
test("actual authenticated Customer and Admin routes enforce ownership and persist audit", async () => {
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", require("../routes/auth.routes"));
  app.use("/api/admin", require("../routes/admin.routes"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = u => jwt.sign({ id: String(u._id), authTokenVersion: 0 }, process.env.JWT_SECRET);
  const http = async (path, method, body, u) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json",
      ...(u ? { Authorization: `Bearer ${token(u)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { code: r.status, body: await r.json() };
  };
  try {
    const path = `/api/admin/users/${customer._id}/profile`;
    assert.equal((await http("/api/auth/profile", "PUT", { fullName: "No auth" })).code, 401);
    assert.equal((await http(path, "PUT", { fullName: "Intruder", reason: "Unauthorized request" }, other)).code, 403);
    const saved = await http(path, "PUT", { fullName: "HTTP Updated", address: "12 Sandbox Lane", reason: "Customer requested update" }, admin);
    assert.equal(saved.code, 200, JSON.stringify(saved.body));
    const profile = await http("/api/auth/profile", "GET", null, customer);
    assert.equal(profile.code, 200);
    assert.equal(profile.body.user.address, "12 Sandbox Lane");
    const history = await http(`${path}/history`, "GET", null, admin);
    assert.equal(history.code, 200); assert.equal(history.body.data.total, 1);
    assert.equal((await http(path, "PUT", { phone: "08060000010", reason: "Unverified phone" }, admin)).code, 400);
    const pendingPath = `${path}/contact-proposal`;
    assert.equal((await http(pendingPath, "GET")).code, 401);
    assert.equal((await http(pendingPath, "GET", null, customer)).code, 403);
    const proposed = await http(pendingPath, "PUT", {
      email: "pending.http@example.invalid", currentPassword: password,
      reason: "Record a pending contact correction", expectedProposalId: null,
    }, admin);
    assert.equal(proposed.code, 200, JSON.stringify(proposed.body));
    assert.equal(proposed.body.data.proposal.status, "PENDING_VERIFICATION");
    // Simulate unrelated legacy audit metadata only inside the disposable replica.
    await Audit.collection.updateOne({ action: "PROFILE_CONTACT_PROPOSED" }, { $set: {
      "metadata.internalNote": "private-metadata-marker",
      "metadata.pendingContact.internalNote": "private-metadata-marker",
    } });
    const pendingRead = await http(pendingPath, "GET", null, admin);
    assert.equal(pendingRead.body.data.proposal.id, proposed.body.data.proposal.id);
    const unchanged = await http("/api/auth/profile", "GET", null, customer);
    assert.equal(unchanged.body.user.email, customer.email);
    assert.equal(unchanged.body.user.profileContactProposal, undefined);
    const withdrawn = await http(pendingPath, "DELETE", {
      currentPassword: password, reason: "Withdraw the sandbox correction",
      expectedProposalId: proposed.body.data.proposal.id,
    }, admin);
    assert.equal(withdrawn.code, 200, JSON.stringify(withdrawn.body));
    assert.equal(withdrawn.body.data.proposal, null);
    const expandedHistory = await http(`${path}/history`, "GET", null, admin);
    assert.equal(expandedHistory.body.data.total, 3);
    assert.equal(expandedHistory.body.data.history[0].action, "PROFILE_CONTACT_WITHDRAWN");
    assert.equal(JSON.stringify(expandedHistory.body).includes("private-metadata-marker"), false);
    assert.equal((await http(`${path}/history`, "GET", null, customer)).code, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("unchanged legacy contacts and absent email do not block a basic profile edit", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { phone: "legacy-phone" }, $unset: { email: 1 } });
  const result = await invoke("updateSelf", { fullName: "Updated Name", phone: "legacy-phone", email: "", address: "10 Sandbox Road" });
  assert.equal(result.code, 200);
  const u = await User.findById(customer._id);
  assert.equal(u.email, undefined);
  assert.equal(u.phone, "legacy-phone");
  assert.equal(u.fullName, "Updated Name");
  assert.equal(sent.length, 0);
});
test("concurrent verified claims cannot give two customers the same email", async () => {
  const first = await challenge("email", "shared@example.invalid");
  const second = await challenge("email", "shared@example.invalid", other);
  const results = await Promise.all([
    invoke("updateSelf", { email: "shared@example.invalid", contactVerifications: { email: first } }),
    invoke("updateSelf", { email: "shared@example.invalid", contactVerifications: { email: second } }, other),
  ]);
  assert.deepEqual(results.map(r => r.code).sort(), [200, 409]);
  assert.equal(await User.countDocuments({ email: "shared@example.invalid" }), 1);
});
test("phase one blocks OTP dispatch for both Customer and Head Office", async () => {
  delete process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED;
  for (const actor of [customer, admin]) {
    const response = await invoke(actor.role === "CUSTOMER" ? "requestSelfContact" : "requestAdminContact",
      { field: "email", value: "unverified@example.invalid", currentPassword: password, reason: "Support verification check" }, actor);
    assert.equal(response.code, 503);
    assert.equal(response.body.code, "CONTACT_VERIFICATION_UNAVAILABLE");
    assert.match(response.body.message, /temporarily unavailable/);
  }
  assert.equal(sent.length, 0);
});
test("phase one refuses a previously valid OTP proof without modifying the customer", async () => {
  const verification = await challenge();
  process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED = "false";
  const response = await invoke("updateSelf", { email: "changed@example.invalid", contactVerifications: { email: verification } });
  assert.equal(response.code, 503);
  assert.equal(response.body.code, "CONTACT_VERIFICATION_UNAVAILABLE");
  assert.equal((await User.findById(customer._id)).email, customer.email);
  assert.equal(await Audit.countDocuments({}), 0);
});
test("phase one permits name and address saves with unchanged contacts", async () => {
  delete process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED;
  for (const actor of [customer, admin]) {
    const response = await invoke(actor.role === "CUSTOMER" ? "updateSelf" : "updateAdmin",
      { fullName: "Phase One Customer", address: "24 Sandbox Avenue", phone: customer.phone,
        email: customer.email, reason: "Customer requested address correction" }, actor);
    assert.equal(response.code, 200);
  }
  assert.equal(sent.length, 0);
  assert.equal(await Audit.countDocuments({}), 2);
  assert.equal((await User.findById(customer._id)).address, "24 Sandbox Avenue");
});
test("Head Office contact mutation requires direct correction credentials even when OTP is unavailable", async () => {
  delete process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED;
  const r = await invoke("updateAdmin", { fullName: "Must Not Persist", phone: "08060000010", reason: "Forbidden contact change" }, admin);
  assert.equal(r.code, 400);
  const stored = await User.findById(customer._id);
  assert.equal(stored.phone, customer.phone);
  assert.equal(stored.fullName, customer.fullName);
});
test("profile picture upload remains available without contact verification and preserves account data", async () => {
  delete process.env.SERVICEPAY_PROFILE_CONTACT_CHANGES_ENABLED;
  const cloudinary = require("cloudinary").v2;
  const original = cloudinary.uploader.upload_stream;
  const keys = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  keys.forEach(k => { process.env[k] = "sandbox-not-production"; });
  cloudinary.uploader.upload_stream = (options, callback) => ({
    end(buffer) {
      assert.equal(options.public_id, `user_${customer._id}`);
      assert.equal(options.resource_type, "image");
      assert.ok(Buffer.isBuffer(buffer));
      callback(null, { secure_url: "https://example.invalid/avatar.png", public_id: options.public_id });
    },
  });
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  try {
    await auth.updateProfilePhoto({ user: { _id: customer._id }, file: { mimetype: "image/png", buffer: Buffer.from("sandbox-image") } }, res);
    assert.equal(res.code, 200);
    assert.equal((await User.findById(customer._id)).profilePhotoUrl, "https://example.invalid/avatar.png");
    assert.equal(sent.length, 0);
  } finally {
    cloudinary.uploader.upload_stream = original;
    keys.forEach(k => { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; });
  }
});
