"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const express = require("express");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model"), Role = require("../models/role.model");
const Transaction = require("../models/transaction.model");
const { Record } = require("../services/marketing.service");
const perf = require("../services/marketingPerformance.service");
let mongo, server, base, admin, superAdmin, head, officer, other, count = 0, report;
const key = () => "performance_fixture_" + String(++count).padStart(8, "0");
async function fixture(role, extra = {}) {
  const n = ++count;
  return User.create({ fullName: "Performance fixture " + n, email: `perf-${n}@example.test`,
    phone: "080" + String(n).padStart(8, "0"), password: "FixtureOnlyTest9!", status: "ACTIVE", role, ...extra });
}
async function api(path, actor = admin, method = "GET", body, requestKey) {
  const res = await fetch(base + path, { method, headers: {
    Authorization: "Bearer " + jwt.sign({ id: String(actor._id), authTokenVersion: actor.authTokenVersion || 0 },
      process.env.JWT_SECRET, { expiresIn: "30m" }),
    "Content-Type": "application/json", "Idempotency-Key": requestKey || key(),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (path.includes("/export")) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") };
  return { status: res.status, ...await res.json() };
}
const create = (kind, body, actor = head) => api("/records/" + kind, actor, "POST", body);
const change = (row, status, actor = head) => api(`/records/${row.kind}/${row._id}/transition`, actor,
  "POST", { revision: row.revision, status, reason: "Checked recorded fixture evidence." });
function target(period, officerId = officer.id, metric = "ACQUISITIONS") {
  const b = perf.bounds(period);
  return { title: period + " target", officerId, description: "Verified goal",
    data: { period, metric, value: 2, startsAt: b.from.toISOString(), endsAt: b.to.toISOString(), objective: "Grow responsibly" } };
}
test.before(async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.MONGODB_URI, undefined);
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "disposable-marketing-performance" });
  await Promise.all([User.init(), Role.init(), Transaction.init()]);
  await Record.createCollection(); await Record.createIndexes();
  const hr = await Role.create({ name: "HEAD_OF_MARKETING", displayName: "Marketing lead", department: "MARKETING",
    hierarchyLevel: 60, permissions: ["marketing.view", "marketing.team.manage", "marketing.reports.manage",
      "marketing.content.manage", "marketing.content.approve", "marketing.attribution.manage", "marketing.export", "marketing.audit"] });
  const or = await Role.create({ name: "MARKETING_OFFICER", displayName: "Officer", department: "MARKETING",
    hierarchyLevel: 20, permissions: ["marketing.view", "marketing.reports.manage", "marketing.content.manage"] });
  admin = await fixture("HEAD_OFFICE"); superAdmin = await fixture("SUPER_ADMIN");
  head = await fixture("STAFF", { isStaff: true, department: "MARKETING", staffRoleId: hr._id });
  officer = await fixture("STAFF", { isStaff: true, department: "MARKETING", staffRoleId: or._id });
  other = await fixture("STAFF", { isStaff: true, department: "MARKETING", staffRoleId: or._id });
  const app = express(); app.use(express.json()); app.use("/marketing", require("../routes/marketing.routes"));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/marketing`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
for (const period of perf.PERIODS) {
  test(`${period} target assignment is idempotent and has independent measurable progress`, async () => {
    const payload = target(period), k = key();
    const first = await api("/records/target", head, "POST", payload, k);
    assert.equal(first.status, 201, JSON.stringify(first));
    const retry = await api("/records/target", head, "POST", payload, k);
    assert.equal(retry.data._id, first.data._id);
    assert.equal(await Record.countDocuments({ kind: "notification", officerId: officer._id,
      "data.recordId": first.data._id, "data.event": "TARGET_ASSIGNED" }), 1);
    const dashboard = await api("/performance/me", officer);
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard));
    const t = dashboard.data.periods.find(p => p.period === period).targets.find(t => t._id === first.data._id);
    assert.equal(t.actual, 0); assert.equal(t.remaining, 2); assert.equal(t.achievementPercent, 0);
  });
  test(`${period} reports retain their period through approval and archive search`, async () => {
    const b = perf.bounds(period);
    let r = await create("report", { title: period + " historical report", data: {
      period, startsAt: b.from.toISOString(), endsAt: b.to.toISOString(), activities: "Fixture activity" } }, other);
    assert.equal(r.status, 201);
    r = await change(r.data, "SUBMITTED", other); assert.equal(r.status, 200);
    r = await change(r.data, "APPROVED", head); assert.equal(r.status, 200);
    const search = await api("/performance/archive?kind=report&period=" + period, other);
    assert(search.data.items.some(item => item._id === r.data._id && item.data.period === period));
  });
}
test("authorized target edits preserve optimistic locking and assignment hierarchy", async () => {
  const r = await create("target", target("DAILY"));
  assert.equal(r.status, 201);
  const changed = await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: 0, title: "Updated measurable goal", data: { value: 3 } });
  assert.equal(changed.status, 200); assert.equal(changed.data.data.value, 3);
  assert.equal((await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: 0, title: "Stale" })).status, 409);
  assert.equal((await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: changed.data.revision, officerId: head.id })).status, 403);
});
test("Head Office assigns leaders; leaders cannot self-assign or target another leader", async () => {
  const schema = await api("/schema", head);
  assert(schema.data.permissions.includes("marketing.targets.manage"));
  assert.equal((await create("target", target("DAILY", head.id), admin)).status, 201);
  assert.equal((await create("target", target("DAILY", head.id), head)).status, 403);
  assert.equal((await create("target", target("DAILY"), officer)).status, 403);
});
test("officers cannot edit targets or view another officer dashboard, reports, archives or history", async () => {
  const r = await create("target", target("DAILY", other.id));
  assert.equal((await api(`/records/target/${r.data._id}`, officer, "PATCH",
    { revision: 0, title: "Changed" })).status, 403);
  assert.equal((await api("/performance/staff/" + other.id, officer)).status, 404);
  const list = await api("/records/target?officerId=" + other.id, officer);
  assert.equal(list.data.total, 0);
  assert.equal((await api(`/performance/history/target/${r.data._id}`, officer)).status, 404);
  const archive = await api("/performance/archive?kind=target", officer);
  assert(archive.data.items.every(t => t.officerId === officer.id));
});
test("officers get private overview and team, never department rankings or global exports", async () => {
  const overview = await api("/overview", officer);
  assert.equal(overview.status, 200); assert(overview.data.personal);
  assert.equal(overview.data.officers, undefined);
  const team = await api("/team", officer);
  assert.deepEqual(team.data.items.map(u => u._id), [officer.id]);
  assert.equal((await api("/performance/department", officer)).status, 403);
  assert.equal((await api("/export/overview?format=pdf", officer)).status, 403);
});
test("report draft, edit, submit, correction, resubmission and approval preserve every review", async () => {
  const b = perf.bounds("DAILY");
  let r = await create("report", { title: "Daily activity", data: {
    period: "DAILY", startsAt: b.from.toISOString(), endsAt: b.to.toISOString(),
    activities: "Meetings and outreach", acquired: 999, activated: 999, firstTransactions: 999,
    campaigns: 999, completedTasks: 999, socialActivities: "Reported activity", meetings: "One meeting",
    challenges: "Transport", nextSteps: "Follow up", evidence: "Fixture report" } }, officer);
  assert.equal(r.status, 201, JSON.stringify(r)); assert.equal(r.data.status, "DRAFT");
  r = await api(`/records/report/${r.data._id}`, officer, "PATCH", { revision: r.data.revision,
    description: "Updated before review" });
  assert.equal(r.status, 200); r = await change(r.data, "SUBMITTED", officer);
  assert.equal(r.status, 200);
  assert.equal((await change(r.data, "APPROVED", officer)).status, 403);
  assert.equal((await change(r.data, "APPROVED", other)).status, 404);
  r = await change(r.data, "CORRECTIONS_REQUESTED", head); assert.equal(r.status, 200);
  r = await change(r.data, "SUBMITTED", officer); assert.equal(r.status, 200);
  r = await change(r.data, "REJECTED", head); assert.equal(r.status, 200);
  r = await change(r.data, "SUBMITTED", officer); assert.equal(r.status, 200);
  r = await change(r.data, "APPROVED", head); assert.equal(r.status, 200);
  assert.equal(r.data.data.reviews.length, 3); report = r.data;
  assert.equal((await api(`/records/report/${report._id}`, officer, "PATCH",
    { revision: report.revision, title: "Overwrite approved" })).status, 409);
  const history = await api(`/performance/history/report/${report._id}`, officer);
  assert(history.data.items.length >= 7);
  const measured = await perf.measure(officer._id, b.from, b.to);
  assert.equal(measured.verified.ACQUISITIONS, 0); assert.equal(measured.verified.FIRST_TRANSACTIONS, 0);
  assert.equal(measured.verified.TASKS, 0); assert.equal(measured.verified.REPORTS, 1);
});
test("report ownership cannot be reassigned and leader reports require Head Office review", async () => {
  const b = perf.bounds("DAILY");
  assert.equal((await create("report", { title: "Forgery", officerId: other.id,
    data: { period: "DAILY", startsAt: b.from.toISOString(), endsAt: b.to.toISOString() } }, officer)).status, 403);
  let r = await create("report", { title: "Leader daily", data: {
    period: "DAILY", startsAt: b.from.toISOString(), endsAt: b.to.toISOString() } }, head);
  r = await change(r.data, "SUBMITTED", head);
  assert.equal((await change(r.data, "APPROVED", head)).status, 403);
  assert.equal((await change(r.data, "APPROVED", admin)).status, 200);
});
test("archive and restore retain original records and immutable archive events", async () => {
  let r = await api(`/performance/archive/report/${report._id}`, officer, "POST",
    { revision: report.revision, archived: true, reason: "Keep historical daily report" });
  assert.equal(r.status, 200, JSON.stringify(r)); assert(r.data.data.archivedAt);
  const search = await api("/performance/archive?archived=true&kind=report&period=DAILY&search=Daily", officer);
  assert.equal(search.data.total, 1);
  assert.equal((await api(`/records/report/${report._id}`, officer, "PATCH",
    { revision: r.data.revision, description: "Wrong" })).status, 409);
  r = await api(`/performance/archive/report/${report._id}`, officer, "POST",
    { revision: r.data.revision, archived: false, reason: "Restore visibility" });
  assert.equal(r.status, 200); assert.equal(r.data.data.archivedAt, undefined);
  assert.equal(await Record.countDocuments({ kind: "archive", "data.recordId": report._id }), 2);
  assert(await Record.exists({ _id: report._id, status: "APPROVED" }));
});
test("officers cannot archive current assigned targets or incomplete tasks", async () => {
  const t = await create("target", target("DAILY"));
  assert.equal((await api(`/performance/archive/target/${t.data._id}`, officer, "POST",
    { revision: 0, archived: true, reason: "Hide" })).status, 403);
  assert.equal((await api(`/performance/archive/target/${t.data._id}`, head, "POST",
    { revision: 0, archived: true, reason: "Hide" })).status, 409);
});
test("task submission is private and completion requires manager confirmation", async () => {
  let r = await create("task", { title: "Assigned work", officerId: officer.id,
    data: { dueAt: new Date(Date.now() - 86400000).toISOString() } });
  assert.equal(r.status, 201);
  r = await change(r.data, "IN_PROGRESS", officer); assert.equal(r.status, 200);
  r = await change(r.data, "SUBMITTED", officer); assert.equal(r.status, 200);
  assert.equal((await change(r.data, "COMPLETED", officer)).status, 403);
  r = await change(r.data, "COMPLETED", head); assert.equal(r.status, 200);
  const b = perf.bounds("DAILY");
  assert.equal((await perf.measure(officer._id, b.from, b.to)).verified.TASKS, 1);
});
test("verified acquisition and earliest successful service transaction are counted once across independent periods", async () => {
  const customer = await fixture("CUSTOMER");
  const attribution = await create("attribution", { title: "Confirmed source", customerId: customer.id,
    officerId: officer.id, data: { source: "REFERRAL", evidence: "No referral exists" } });
  assert.equal(attribution.status, 400);
  // Local fixture-only source establishes one immutable attribution.
  await Record.create({ kind: "attribution", title: "Verified fixture source", status: "CONFIRMED",
    officerId: officer._id, customerId: customer._id, createdBy: head._id, updatedBy: head._id, requestKey: key() });
  for (let i = 0; i < 2; i++) await Transaction.create({
    customerId: customer._id, serviceType: "DATA", amount: 100, status: "SUCCESSFUL",
    reference: key(), phone: "08000000000" });
  for (const p of perf.PERIODS) {
    const b = perf.bounds(p), m = await perf.measure(officer._id, b.from, b.to);
    assert.equal(m.verified.ACQUISITIONS, 1); assert.equal(m.verified.FIRST_TRANSACTIONS, 1);
  }
  const b = perf.bounds("DAILY");
  const future = await perf.measure(officer._id, b.to, new Date(+b.to + 86400000));
  assert.equal(future.verified.ACQUISITIONS, 0); assert.equal(future.verified.FIRST_TRANSACTIONS, 0);
});
test("custom and unverified engagement targets remain unavailable instead of using self reports", async () => {
  const payload = target("YEARLY", officer.id, "CUSTOM"); payload.data.customMetric = "Brand awareness";
  const r = await create("target", payload); assert.equal(r.status, 201);
  const d = await api("/performance/me", officer);
  const result = d.data.targets.find(t => t._id === r.data._id);
  assert.equal(result.actual, null); assert.equal(result.outcome, "UNAVAILABLE");
});
test("Super Admin configures transparent weights with optimistic locking; Head Office cannot change methodology", async () => {
  const p = await api("/performance/ranking-policy");
  const body = { revision: p.data.revision, weights: perf.WEIGHTS, reason: "Approved fixture methodology" };
  assert.equal((await api("/performance/ranking-policy", admin, "PATCH", body)).status, 403);
  const r = await api("/performance/ranking-policy", superAdmin, "PATCH", body);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal((await api("/performance/ranking-policy", superAdmin, "PATCH", body)).status, 409);
  const ranking = await api("/performance/department?period=DAILY", head);
  assert.equal(ranking.status, 200); assert(ranking.data.methodology.methodology.length > 0);
  const first = ranking.data.items.find(r => r.id === officer.id);
  assert(first.score != null); assert.equal(first.acquisitions, 1);
  assert.equal(ranking.data.items.find(r => r.id === other.id).acquisitions, 0);
  const noTarget = await fixture("STAFF", { isStaff: true, department: "MARKETING", staffRoleId: other.staffRoleId });
  const withUnassigned = await api("/performance/department?period=DAILY", head);
  assert.equal(withUnassigned.data.items.find(r => r.id === noTarget.id).score, null);
});
test("snapshot is immutable and idempotent, with server-measured values only", async () => {
  const body = { officerId: officer.id, period: "DAILY" };
  const r = await api("/performance/snapshot", head, "POST", body);
  assert.equal(r.status, 201, JSON.stringify(r));
  const second = await api("/performance/snapshot", admin, "POST", body);
  assert.equal(r.data._id, second.data._id);
  assert.equal(r.data.data.verified.ACQUISITIONS, 1);
  assert.equal((await api("/performance/snapshot", officer, "POST", body)).status, 403);
  assert.equal((await api(`/records/performance/${r.data._id}`, officer, "PATCH",
    { revision: 0, title: "Fake" })).status, 403);
});
test("reminders, weekly/monthly summaries and notifications are durable, deduplicated and private", async () => {
  const first = await api("/performance/notifications", officer); assert.equal(first.status, 200);
  const second = await api("/performance/notifications", officer); assert.equal(second.status, 200);
  assert.equal(first.data.items.length, second.data.items.length);
  assert(first.data.items.some(r => r.data.event === "WEEKLY_SUMMARY"));
  assert(first.data.items.some(r => r.data.event === "MONTHLY_SUMMARY"));
  const notification = first.data.items[0];
  assert.equal((await api(`/performance/notifications/${notification._id}/read`, other, "POST", {})).status, 404);
  assert.equal((await api(`/performance/notifications/${notification._id}/read`, officer, "POST", {})).status, 200);
});
test("missed targets and deadline warnings are verified and generated once", async () => {
  const payload = target("DAILY"); payload.data.startsAt = new Date(Date.now() - 3 * 86400000).toISOString();
  payload.data.endsAt = new Date(Date.now() - 2 * 86400000).toISOString();
  const r = await create("target", payload); assert.equal(r.status, 201);
  await api("/performance/notifications", officer);
  assert.equal(await Record.countDocuments({ kind: "notification", "data.event": "TARGET_MISSED",
    "data.recordId": r.data._id }), 1);
  await api("/performance/notifications", officer);
  assert.equal(await Record.countDocuments({ kind: "notification", "data.event": "TARGET_MISSED",
    "data.recordId": r.data._id }), 1);
});
for (const format of ["pdf", "xlsx"]) {
  test(`${format} personal and department exports honor ownership and contain valid binary signatures`, async () => {
    const personal = await api("/performance/export?format=" + format + "&period=DAILY", officer);
    assert.equal(personal.status, 200); assert.equal(personal.bytes.subarray(0, 2).toString(), format === "pdf" ? "%P" : "PK");
    const department = await api("/performance/export?format=" + format + "&period=MONTHLY&department=true", admin);
    assert.equal(department.status, 200);
    const deny = await api("/performance/export?format=" + format + "&officerId=" + other.id, officer);
    assert.equal(deny.status, 404);
  });
}
test("central management is Admin-only, never a marketing leader or officer capability", async () => {
  assert.equal((await api("/management", admin)).status, 200);
  assert.equal((await api("/management", superAdmin)).status, 200);
  assert.equal((await api("/management", head)).status, 403);
  assert.equal((await api("/management", officer)).status, 403);
});
for (const period of perf.PERIODS) {
  test(`${period} department target is shared without copying individual target records`, async () => {
    const payload = target(period);
    delete payload.officerId;
    payload.title = period + " department shared target";
    payload.data.scope = "DEPARTMENT";
    const k = key();
    const created = await api("/records/target", admin, "POST", payload, k);
    assert.equal(created.status, 201, JSON.stringify(created));
    const retried = await api("/records/target", admin, "POST", payload, k);
    assert.equal(retried.data._id, created.data._id);
    assert.equal(created.data.data.authority, "ADMIN");
    assert.equal(await Record.countDocuments({ title: payload.title }), 1);
    const dashboard = await api("/performance/me", officer);
    const visible = dashboard.data.departmentTargets.find(t => t._id === created.data._id);
    assert(visible); assert.equal(visible.officerId, null);
    assert.equal((await api("/performance/me", head)).data.departmentTargets
      .find(t => t._id === created.data._id).actual, visible.actual);
    const central = await api("/management?period=" + period);
    assert.equal(central.status, 200, JSON.stringify(central));
    assert.equal(central.data.targets.find(t => t._id === created.data._id).actual, visible.actual);
    const listing = await api("/records/target", other);
    assert(listing.data.items.some(t => t._id === created.data._id));
    assert.equal((await create("target", payload, head)).status, 403);
    assert.equal((await api(`/records/target/${created.data._id}`, head, "PATCH",
      { revision: 0, data: { value: 999 } })).status, 403);
    const changed = await api(`/records/target/${created.data._id}`, admin, "PATCH",
      { revision: 0, data: { value: 7 } });
    assert.equal(changed.status, 200, JSON.stringify(changed));
    const refreshed = await api("/performance/me", other);
    assert.equal(refreshed.data.departmentTargets.find(t => t._id === created.data._id).data.value, 7);
  });
}
test("Admin individual targets are immutable to leaders across edit, transition and archive", async () => {
  let r = await create("target", target("DAILY"), admin);
  assert.equal(r.status, 201);
  for (const action of [
    () => api(`/records/target/${r.data._id}`, head, "PATCH", { revision: 0, data: { value: 20 } }),
    () => change(r.data, "PAUSED", head),
    () => api(`/performance/archive/target/${r.data._id}`, head, "POST",
      { revision: 0, archived: true, reason: "Attempted manager override" }),
  ]) assert.equal((await action()).status, 403);
  // Legacy rows predate the authority marker but their immutable author remains.
  await Record.updateOne({ _id: r.data._id }, { $unset: { "data.authority": "" } });
  assert.equal((await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: 0, title: "Unauthorized legacy override" })).status, 403);
  assert.equal((await change(r.data, "PAUSED", admin)).status, 200);
});
test("pause/deactivate/resume preserve target history and optimistic concurrency", async () => {
  let r = await create("target", target("MONTHLY"), admin);
  const recordId = r.data._id;
  r = await change(r.data, "PAUSED", admin); assert.equal(r.status, 200);
  let current = await api("/management?period=MONTHLY");
  assert.equal(current.data.targets.find(t => t._id === recordId).outcome, "PAUSED");
  assert.equal((await api(`/records/target/${recordId}/transition`, admin, "POST",
    { revision: 0, status: "ACTIVE", reason: "Stale request" })).status, 409);
  r = await change(r.data, "INACTIVE", admin); assert.equal(r.status, 200);
  r = await change(r.data, "ACTIVE", admin); assert.equal(r.status, 200);
  const history = await api(`/performance/history/target/${recordId}`);
  assert(history.data.items.length >= 4);
  assert.equal(await Record.countDocuments({ _id: recordId }), 1);
});
test("Admin editing a leader-assigned target retains authorization ownership", async () => {
  const r = await create("target", target("WEEKLY"), head);
  const edited = await api(`/records/target/${r.data._id}`, admin, "PATCH",
    { revision: 0, title: "Admin revised assignment" });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.data.authority, "ADMIN");
  assert.equal((await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: 1, data: { value: 9 } })).status, 403);
});
test("scope and authority cannot be forged or converted into invalid ownership", async () => {
  const forged = target("DAILY"); forged.data.authority = "MANAGER";
  assert.equal((await create("target", forged, admin)).status, 400);
  const scoped = target("DAILY"); scoped.data.scope = "DEPARTMENT";
  assert.equal((await create("target", scoped, admin)).status, 400);
  const r = await create("target", target("DAILY"), head);
  assert.equal((await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: 0, officerId: null })).status, 400);
  assert.equal((await api(`/records/target/${r.data._id}`, head, "PATCH",
    { revision: 0, officerId: null, data: { scope: "DEPARTMENT" } })).status, 403);
});
test("unmeasurable acquisition categories are unavailable, never false successes", async () => {
  for (const metric of ["AGENT_ACQUISITIONS", "MERCHANT_ACQUISITIONS", "CUSTOM"]) {
    const payload = target("DAILY", officer.id, metric);
    if (metric === "CUSTOM") payload.data.customMetric = "Admin configured evidence KPI";
    const r = await create("target", payload, admin);
    assert.equal(r.status, 201, JSON.stringify(r));
    const row = (await api("/management?period=DAILY")).data.targets.find(t => t._id === r.data._id);
    assert.equal(row.actual, null); assert.equal(row.outcome, "UNAVAILABLE");
    assert.equal((await change(r.data, "COMPLETED", admin)).status, 409);
  }
});
test("central filters, independent periods and CSV/Excel reports use the same recorded data", async () => {
  const result = await api("/management?period=YEARLY");
  assert.equal(result.status, 200);
  assert.equal(result.data.periods.length, 4);
  assert(result.data.staff.some(s => s.role === "HEAD_OF_MARKETING" && s.email && s.phone));
  const unavailable = await api("/management?period=YEARLY&performance=UNAVAILABLE");
  assert(unavailable.data.staff.every(s => s.achievement == null));
  const filtered = await api("/management?period=YEARLY&search=nonexistent-fixture");
  assert.equal(filtered.data.staff.length, 0);
  assert.equal((await api("/management?period=BAD")).status, 400);
  assert.equal((await api("/management?performance=BAD")).status, 400);
  const csv = await api("/performance/export?format=csv&period=YEARLY&department=true");
  assert.equal(csv.status, 200); assert.match(csv.type, /text\/csv/);
  assert.match(csv.bytes.toString(), /Metric.*Verified value/);
  assert.equal((await api("/performance/export?format=csv&period=YEARLY&department=true", officer)).status, 403);
});
test("read-only measurements preserve all customer wallets and financial transaction records", async () => {
  const before = await Transaction.find({}).lean();
  const customers = await User.find({ role: "CUSTOMER" }).select("_id walletBalance").lean();
  await api("/performance/department?period=YEARLY", superAdmin);
  await api("/performance/me", officer);
  assert.deepEqual(await Transaction.find({}).lean(), before);
  assert.deepEqual(await User.find({ role: "CUSTOMER" }).select("_id walletBalance").lean(), customers);
});
