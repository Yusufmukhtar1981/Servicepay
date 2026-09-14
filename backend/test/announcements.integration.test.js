const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const announcementRoutes = require("../routes/announcements.routes");
const legacyAnnouncementRoutes = require("../routes/announcement.routes");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const KycProfile = require("../models/kycProfile.model");
const Announcement = require("../models/announcement.model");
const AnnouncementInteraction = require("../models/announcementInteraction.model");

let mongo;
let server;
let base;
let sequence = 0;

const models = [
  User,
  Role,
  KycProfile,
  Announcement,
  AnnouncementInteraction,
];

const makeUser = async (role = "CUSTOMER", extra = {}) => {
  sequence += 1;
  return User.create({
    fullName: `${role} Test ${sequence}`,
    phone: `080${String(sequence).padStart(8, "0")}`,
    email: `${role.toLowerCase()}${sequence}@announcements.test`,
    password: "Passw0rd!",
    role,
    status: "ACTIVE",
    isStaff: role !== "CUSTOMER",
    ...extra,
  });
};

const tokenFor = (user, loginKey) => jwt.sign(
  { id: String(user._id), authTokenVersion: Number(user.authTokenVersion || 0) },
  process.env.JWT_SECRET,
  { jwtid: loginKey, noTimestamp: true },
);

const api = async ({
  method = "GET",
  path,
  actor,
  body,
  loginKey,
} = {}) => {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${tokenFor(actor, loginKey || `request-${sequence}`)}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const announcementBody = (overrides = {}) => ({
  title: "Planned ServicePay update",
  message: "A safe test announcement.",
  type: "INFO",
  style: "BOTH",
  audience: "ALL",
  visibility: "ONCE",
  priority: 10,
  isActive: true,
  ...overrides,
});

let headOffice;
let fullStaff;

test.before(async () => {
  process.env.JWT_SECRET = "announcement-integration-test-secret";
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "announcement-tests" });
  await Promise.all(models.map((model) => model.init()));

  const app = express();
  app.use(express.json());
  app.use("/api/announcements", announcementRoutes);
  app.use("/api/announcement", legacyAnnouncementRoutes);
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.once("error", reject);
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
  sequence = 0;
  headOffice = await makeUser("HEAD_OFFICE");
  const role = await Role.create({
    name: "ANNOUNCEMENT_EDITOR",
    displayName: "Announcement Editor",
    department: "CUSTOMER_SUPPORT",
    permissions: [
      "announcements.view",
      "announcements.summary",
      "announcements.create",
      "announcements.update",
      "announcements.activate",
      "announcements.delete",
    ],
    scopeType: "GLOBAL",
  });
  fullStaff = await makeUser("STAFF", { staffRoleId: role._id });
});

test("plural routes enforce least-privilege staff permissions while allowing authorized CRUD", async () => {
  const unauthenticated = await fetch(`${base}/api/announcements/admin`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(unauthenticated.status, 401);
  const customer = await makeUser();
  assert.equal((await api({ path: "/api/announcements/admin", actor: customer })).status, 403);

  const limitedRole = await Role.create({
    name: "ANNOUNCEMENT_VIEWER",
    displayName: "Announcement Viewer",
    department: "CUSTOMER_SUPPORT",
    permissions: ["announcements.view"],
  });
  const viewer = await makeUser("STAFF", { staffRoleId: limitedRole._id });
  assert.equal((await api({ path: "/api/announcements/admin", actor: viewer })).status, 200);
  assert.equal((await api({ path: "/api/announcements/admin/summary", actor: viewer })).status, 403);
  assert.equal((await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: viewer,
    body: announcementBody(),
  })).status, 403);

  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: fullStaff,
    body: announcementBody(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data.announcement.id;
  const detail = await api({
    path: `/api/announcements/admin/${id}`,
    actor: fullStaff,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.announcement.id, id);
  const updated = await api({
    method: "PATCH",
    path: `/api/announcements/admin/${id}`,
    actor: fullStaff,
    body: { title: "Edited announcement", priority: 42 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.announcement.title, "Edited announcement");
  assert.equal(updated.body.data.announcement.priority, 42);
  assert.equal((await api({ path: "/api/announcements/admin", actor: fullStaff })).body.data.total, 1);
});

test("admin status, summary, scheduled, and expired reporting are server-side", async () => {
  const scheduled = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({
      title: "Scheduled",
      isActive: true,
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  assert.equal(scheduled.status, 201);
  const expired = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({
      title: "Expired",
      isActive: true,
      endAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  });
  assert.equal(expired.status, 201);
  const live = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({
      title: "Currently deliverable",
      isActive: true,
    }),
  });
  assert.equal(live.status, 201);
  const inactive = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ title: "Inactive", isActive: false }),
  });
  assert.equal(inactive.status, 201);

  const scheduledId = scheduled.body.data.announcement.id;
  const activated = await api({
    method: "PATCH",
    path: `/api/announcements/admin/${scheduledId}/status`,
    actor: fullStaff,
    body: { isActive: true },
  });
  assert.equal(activated.status, 200);

  const summary = await api({
    path: "/api/announcements/admin/summary",
    actor: fullStaff,
  });
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.data.summary.total, 4);
  assert.equal(summary.body.data.summary.active, 1);
  assert.equal(summary.body.data.summary.scheduled, 1);
  assert.equal(summary.body.data.summary.expired, 1);
  assert.deepEqual(
    Object.keys(summary.body.data.summary).sort(),
    ["total", "active", "scheduled", "expired", "views", "acknowledgements", "dismissals", "clicks"].sort(),
  );

  const deactivated = await api({
    method: "PATCH",
    path: `/api/announcements/admin/${scheduledId}/deactivate`,
    actor: fullStaff,
    body: {},
  });
  assert.equal(deactivated.status, 200);
  const afterDeactivation = await api({
    path: "/api/announcements/admin/summary",
    actor: fullStaff,
  });
  assert.equal(afterDeactivation.body.data.summary.active, 1);
  assert.equal(afterDeactivation.body.data.summary.scheduled, 0);
});

test("customer schedule filtering and every audience mode target only eligible customers", async () => {
  const alice = await makeUser();
  const bob = await makeUser();
  const pending = await makeUser();
  const verified = await makeUser();
  await KycProfile.create({ user: alice._id, status: "PENDING" });
  await KycProfile.create({ user: pending._id, status: "UNDER_REVIEW" });
  await KycProfile.create({ user: verified._id, status: "VERIFIED" });

  const bodies = [
    announcementBody({ title: "All", audience: "ALL" }),
    announcementBody({ title: "Active", audience: "ACTIVE" }),
    announcementBody({ title: "Pending", audience: "KYC_PENDING" }),
    announcementBody({ title: "Verified", audience: "KYC_VERIFIED" }),
    announcementBody({
      title: "Selected customer",
      audience: "SELECTED_CUSTOMERS",
      selectedCustomerIds: [alice._id],
    }),
    announcementBody({
      title: "Selected role",
      audience: "SELECTED_ROLE",
      selectedRole: "CUSTOMER",
    }),
    announcementBody({
      title: "Not yet",
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
    announcementBody({
      title: "Already over",
      endAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  ];
  for (const body of bodies) {
    const response = await api({
      method: "POST",
      path: "/api/announcements/admin",
      actor: headOffice,
      body,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }

  const aliceActive = await api({ path: "/api/announcements/active", actor: alice, loginKey: "alice-a" });
  assert.equal(aliceActive.status, 200);
  const aliceTitles = aliceActive.body.data.announcements.map((item) => item.title);
  assert.deepEqual(new Set(aliceTitles), new Set(["All", "Active", "Pending", "Selected customer", "Selected role"]));
  assert.equal(aliceTitles.join("|").includes("Verified"), false);
  assert.equal(aliceTitles.join("|").includes("Not yet"), false);
  assert.equal(aliceTitles.join("|").includes("Already over"), false);

  const verifiedActive = await api({ path: "/api/announcements/active", actor: verified, loginKey: "verified-a" });
  const verifiedTitles = verifiedActive.body.data.announcements.map((item) => item.title);
  assert.ok(verifiedTitles.includes("Verified"));
  assert.equal(verifiedTitles.includes("Pending"), false);
  assert.equal(verifiedTitles.includes("Selected customer"), false);
  assert.equal(verifiedTitles.includes("Selected role"), true);

  const pendingActive = await api({ path: "/api/announcements/active", actor: pending, loginKey: "pending-a" });
  const pendingTitles = pendingActive.body.data.announcements.map((item) => item.title);
  assert.ok(pendingTitles.includes("Pending"));
  assert.equal(pendingTitles.includes("Verified"), false);

  const bobActive = await api({ path: "/api/announcements/active", actor: bob, loginKey: "bob-a" });
  assert.equal(bobActive.body.data.announcements.some((item) => item.title === "Selected customer"), false);
});

test("KYC pending means explicit pending workflow states, never rejected or not-started", async () => {
  const pending = await makeUser();
  const underReview = await makeUser();
  const rejected = await makeUser();
  const notStarted = await makeUser();
  await KycProfile.create({ user: pending._id, status: "PENDING" });
  await KycProfile.create({ user: underReview._id, status: "UNDER_REVIEW" });
  await KycProfile.create({ user: rejected._id, status: "REJECTED" });
  await KycProfile.create({ user: notStarted._id, status: "NOT_STARTED" });
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ audience: "KYC_PENDING", title: "KYC queue" }),
  });
  assert.equal(created.status, 201);
  for (const customer of [pending, underReview]) {
    const response = await api({ path: "/api/announcements/active", actor: customer, loginKey: String(customer._id) });
    assert.equal(response.body.data.announcements.length, 1);
  }
  for (const customer of [rejected, notStarted]) {
    const response = await api({ path: "/api/announcements/active", actor: customer, loginKey: String(customer._id) });
    assert.equal(response.body.data.announcements.length, 0);
  }
});

test("selected role rejects roles outside customer delivery support", async () => {
  const impossible = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ audience: "SELECTED_ROLE", selectedRole: "HEAD_OFFICE" }),
  });
  assert.equal(impossible.status, 400);
  const supported = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ audience: "SELECTED_ROLE", selectedRole: "CUSTOMER" }),
  });
  assert.equal(supported.status, 201);
});

test("customer responses redact selected customer and role targeting", async () => {
  const alice = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ audience: "SELECTED_CUSTOMERS", selectedCustomerIds: [alice._id] }),
  });
  assert.equal(created.status, 201);
  const active = await api({ path: "/api/announcements/active", actor: alice, loginKey: "redaction" });
  assert.equal(active.status, 200);
  const serialized = JSON.stringify(active.body);
  assert.equal(serialized.includes(String(alice._id)), false);
  assert.equal(serialized.includes("selectedCustomerIds"), false);
  assert.equal(serialized.includes("selectedRole"), false);
  assert.equal("audience" in active.body.data.announcements[0], false);
  assert.equal(
    Number.isNaN(Date.parse(active.body.data.announcements[0].createdAt)),
    false,
  );
});

test("CTA validation rejects unsafe schemes but accepts HTTPS", async () => {
  const unsafe = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ cta: { label: "Open", url: "javascript:alert(1)" } }),
  });
  assert.equal(unsafe.status, 400);
  const dataScheme = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ cta: { label: "Open", url: "data:text/html,hello" } }),
  });
  assert.equal(dataScheme.status, 400);
  const safe = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ cta: { label: "Open", url: "https://servicepay.test/help" } }),
  });
  assert.equal(safe.status, 201);
});

test("view, acknowledgement, dismissal, and click are idempotent metrics", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ visibility: "UNTIL_DISMISSED" }),
  });
  const id = created.body.data.announcement.id;
  for (const action of ["view", "acknowledge", "dismiss", "click"]) {
    const first = await api({ method: "POST", path: `/api/announcements/${id}/${action}`, actor: customer, loginKey: "actions" });
    const duplicate = await api({ method: "POST", path: `/api/announcements/${id}/${action}`, actor: customer, loginKey: "actions" });
    assert.equal(first.status, 200, `${action}: ${JSON.stringify(first.body)}`);
    assert.equal(duplicate.status, 200, `${action} duplicate: ${JSON.stringify(duplicate.body)}`);
    assert.equal(duplicate.body.data.recorded, false);
  }
  const stored = await Announcement.findById(id).lean();
  assert.deepEqual(stored.metrics, {
    views: 1,
    acknowledgements: 1,
    dismissals: 1,
    clicks: 1,
  });
  assert.equal(await AnnouncementInteraction.countDocuments({ announcementId: id, customerId: customer._id }), 1);
});

test("mandatory announcements cannot be dismissed and remain until acknowledged", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ visibility: "MANDATORY" }),
  });
  const id = created.body.data.announcement.id;
  const dismissed = await api({ method: "POST", path: `/api/announcements/${id}/dismiss`, actor: customer });
  assert.equal(dismissed.status, 409);
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "mandatory" })).body.data.announcements.length, 1);
  const acknowledged = await api({ method: "POST", path: `/api/announcements/${id}/acknowledge`, actor: customer });
  assert.equal(acknowledged.status, 200);
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "mandatory" })).body.data.announcements.length, 0);
});

test("once visibility disappears after a view or acknowledgement", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ visibility: "ONCE" }),
  });
  const id = created.body.data.announcement.id;
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "once" })).body.data.announcements.length, 1);
  const viewed = await api({ method: "POST", path: `/api/announcements/${id}/view`, actor: customer, loginKey: "once" });
  assert.equal(viewed.status, 200);
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "once" })).body.data.announcements.length, 0);
  assert.equal((await api({ method: "POST", path: `/api/announcements/${id}/acknowledge`, actor: customer, loginKey: "once" })).status, 200);
});

test("every-login visibility is shown once per login marker", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ visibility: "EVERY_LOGIN" }),
  });
  const id = created.body.data.announcement.id;
  assert.ok(id);
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "login-one" })).body.data.announcements.length, 1);
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "login-one" })).body.data.announcements.length, 0);
  assert.equal((await api({ path: "/api/announcements/active", actor: customer, loginKey: "login-two" })).body.data.announcements.length, 1);
});

test("interaction ownership prevents cross-customer recording", async () => {
  const alice = await makeUser();
  const bob = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ audience: "SELECTED_CUSTOMERS", selectedCustomerIds: [alice._id] }),
  });
  const id = created.body.data.announcement.id;
  const bobView = await api({ method: "POST", path: `/api/announcements/${id}/view`, actor: bob });
  assert.equal(bobView.status, 404);
  assert.equal(await AnnouncementInteraction.countDocuments(), 0);
  const aliceView = await api({ method: "POST", path: `/api/announcements/${id}/view`, actor: alice });
  assert.equal(aliceView.status, 200);
  assert.equal(await AnnouncementInteraction.countDocuments({ customerId: bob._id }), 0);
  assert.equal((await Announcement.findById(id)).metrics.views, 1);
});

test("admin deletion removes the announcement and all interaction state", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody(),
  });
  const id = created.body.data.announcement.id;
  assert.equal((await api({ method: "POST", path: `/api/announcements/${id}/view`, actor: customer })).status, 200);
  assert.equal(await AnnouncementInteraction.countDocuments({ announcementId: id }), 1);
  const deleted = await api({
    method: "DELETE",
    path: `/api/announcements/admin/${id}`,
    actor: fullStaff,
  });
  assert.equal(deleted.status, 200);
  assert.equal(await Announcement.exists({ _id: id }), null);
  assert.equal(await AnnouncementInteraction.countDocuments({ announcementId: id }), 0);
  assert.equal((await api({ method: "POST", path: `/api/announcements/${id}/view`, actor: customer })).status, 404);
});

test("concurrent identical interactions increment one marker and one metric", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody({ visibility: "UNTIL_DISMISSED" }),
  });
  const id = created.body.data.announcement.id;
  const actions = ["view", "acknowledge", "dismiss", "click"];
  for (const action of actions) {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => api({
        method: "POST",
        path: `/api/announcements/${id}/${action}`,
        actor: customer,
        loginKey: "parallel",
      })),
    );
    assert.ok(responses.every((response) => response.status === 200), `${action} race failed`);
    assert.equal(responses.filter((response) => response.body.data.recorded).length, 1);
  }
  const stored = await Announcement.findById(id).lean();
  assert.deepEqual(stored.metrics, { views: 1, acknowledgements: 1, dismissals: 1, clicks: 1 });
  assert.equal(await AnnouncementInteraction.countDocuments({ announcementId: id }), 1);
});

test("concurrent interaction and hard delete cannot recreate orphan state", async () => {
  const customer = await makeUser();
  const created = await api({
    method: "POST",
    path: "/api/announcements/admin",
    actor: headOffice,
    body: announcementBody(),
  });
  const id = created.body.data.announcement.id;
  const requests = Array.from({ length: 10 }, () => api({
    method: "POST",
    path: `/api/announcements/${id}/view`,
    actor: customer,
    loginKey: "delete-race",
  }));
  requests.push(api({
    method: "DELETE",
    path: `/api/announcements/admin/${id}`,
    actor: fullStaff,
  }));
  await Promise.all(requests);
  assert.equal(await Announcement.exists({ _id: id }), null);
  assert.equal(await AnnouncementInteraction.countDocuments({ announcementId: id }), 0);
});

test("legacy singular announcement GET remains available beside plural routes", async () => {
  await Announcement.create({
    title: "Legacy-compatible announcement",
    message: "The old dashboard can still read this.",
    isActive: true,
    legacyEligible: true,
  });
  const response = await fetch(`${base}/api/announcement`, { headers: { Accept: "application/json" } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.announcement.title, "Legacy-compatible announcement");
  assert.equal(body.data.announcement.isActive, true);
  assert.deepEqual(Object.keys(body.data.announcement).sort(), ["isActive", "message", "title"]);
});

test("legacy GET never exposes plural targeting or scheduled records, and legacy PUT stays safe", async () => {
  const targeted = await Announcement.create({
    title: "Targeted secret",
    message: "Must not be returned by legacy API.",
    audience: "SELECTED_CUSTOMERS",
    selectedCustomerIds: [headOffice._id],
    isActive: true,
    legacyEligible: false,
  });
  await Announcement.create({
    title: "Scheduled plural",
    message: "Must not be returned by legacy API.",
    audience: "ALL",
    startAt: new Date(Date.now() + 60 * 60 * 1000),
    isActive: true,
    legacyEligible: false,
  });
  const emptyResponse = await fetch(`${base}/api/announcement`);
  const emptyBody = await emptyResponse.json();
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(emptyBody.data.announcement, { title: "", message: "", isActive: false });

  const legacy = await Announcement.create({
    title: "Safe legacy",
    message: "Safe body",
    isActive: true,
    legacyEligible: true,
  });
  const response = await fetch(`${base}/api/announcement`, {
    headers: { Accept: "application/json" },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.announcement.title, "Safe legacy");
  assert.equal(JSON.stringify(body.data.announcement).includes(String(targeted._id)), false);
  assert.equal("metrics" in body.data.announcement, false);
  assert.equal("audience" in body.data.announcement, false);
  assert.equal("cta" in body.data.announcement, false);

  const putResponse = await fetch(`${base}/api/announcement/admin`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenFor(headOffice, "legacy-put")}`,
    },
    body: JSON.stringify({
      title: "Updated legacy",
      message: "Updated safe body",
      isActive: true,
      audience: "SELECTED_CUSTOMERS",
      selectedCustomerIds: [targeted._id],
      cta: { label: "Unsafe field", url: "javascript:alert(1)" },
    }),
  });
  const putBody = await putResponse.json();
  assert.equal(putResponse.status, 200);
  assert.deepEqual(Object.keys(putBody.data.announcement).sort(), ["isActive", "message", "title"]);
  const persisted = await Announcement.findById(legacy._id).lean();
  assert.equal(persisted.title, "Updated legacy");
  assert.equal(persisted.audience, "ALL");
  assert.deepEqual(persisted.selectedCustomerIds, []);
});