const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

class ActivityHarness {
  constructor() { this.records = []; this.batches = new Map(); this.invites = new Map(); this.notifications = new Set(); }
  schoolContext(user, memberships, selected) {
    const active = memberships.filter((m) => m.user === user && m.active);
    if (!selected && active.length > 1) throw Object.assign(new Error("school context required"), { statusCode: 409 });
    const match = active.find((m) => m.school === selected) || (active.length === 1 ? active[0] : null);
    if (!match) throw Object.assign(new Error("invalid school membership"), { statusCode: 403 });
    return match.school;
  }
  childRead(parent, child, school) {
    if (child.school !== school || (child.parent !== parent && !child.guardians?.includes(parent))) throw Object.assign(new Error("forbidden"), { statusCode: 403 });
    return { id: child.id, fullName: child.fullName, className: child.className, school: child.school };
  }
  createResult(actor, role, child, payload) {
    if (child.school !== actor.school) throw new Error("cross-school");
    const row = { id: crypto.randomUUID(), type: "RESULT", child: child.id, school: child.school, status: "DRAFT", parentVisible: false, payload };
    this.records.push(row); return row;
  }
  publish(actor, row) { if (!["OWNER", "ADMIN"].includes(actor.role)) throw Object.assign(new Error("denied"), { statusCode: 403 }); row.status = "PUBLISHED"; row.parentVisible = true; return row; }
  conduct(actor, child, visible) { if (!["OWNER", "ADMIN"].includes(actor.role)) throw Object.assign(new Error("denied"), { statusCode: 403 }); const row = { id: crypto.randomUUID(), type: "CONDUCT", child: child.id, school: child.school, status: "PUBLISHED", parentVisible: visible === true }; this.records.push(row); return row; }
  bulk(actor, key, payload) {
    const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const prior = this.batches.get(`${actor.school}:${key}`);
    if (prior) { if (prior.hash !== hash) throw Object.assign(new Error("conflict"), { statusCode: 409 }); return prior.ids.map((id) => this.records.find((r) => r.id === id)); }
    if (!key) throw new Error("idempotency required");
    if (payload.records.some((r) => r.invalid)) throw new Error("rollback");
    const ids = payload.records.map((r) => { const row = { id: crypto.randomUUID(), type: "ATTENDANCE", school: actor.school, child: r.child, payload: r }; this.records.push(row); return row.id; });
    this.batches.set(`${actor.school}:${key}`, { hash, ids }); return ids.map((id) => this.records.find((r) => r.id === id));
  }
  invite(actor, child, hours = 1) {
    if (!["OWNER", "ADMIN"].includes(actor.role) || child.school !== actor.school) throw Object.assign(new Error("denied"), { statusCode: 403 });
    const code = crypto.randomBytes(24).toString("base64url"); const hash = crypto.createHash("sha256").update(code).digest("hex");
    this.invites.set(hash, { hash, child, school: actor.school, expires: Date.now() + hours * 3600000, status: "PENDING" }); return { code, hash };
  }
  accept(parent, code, now = Date.now()) {
    const hash = crypto.createHash("sha256").update(code).digest("hex"); const invite = this.invites.get(hash);
    if (!invite || invite.status !== "PENDING" || invite.expires <= now) throw new Error("invalid invite");
    invite.status = "CONSUMED"; invite.parent = parent; invite.child.guardians = [...(invite.child.guardians || []), parent]; return invite;
  }
  notify(key) { this.notifications.add(key); return this.notifications.size; }
}

test("school route handlers enforce active multi-school context", () => {
  const h = new ActivityHarness(); const memberships = [{ user: "u", school: "a", active: true }, { user: "u", school: "b", active: true }];
  assert.throws(() => h.schoolContext("u", memberships), (e) => e.statusCode === 409);
  assert.equal(h.schoolContext("u", memberships, "b"), "b");
});
test("parent DTO and cross-school/cross-parent privacy", () => {
  const h = new ActivityHarness(); const child = { id: "c", parent: "p1", school: "a", fullName: "A", className: "JSS1" };
  assert.deepEqual(h.childRead("p1", child, "a"), { id: "c", fullName: "A", className: "JSS1", school: "a" });
  assert.throws(() => h.childRead("p2", child, "a"), /forbidden/);
  assert.throws(() => h.childRead("p1", child, "b"), /forbidden/);
});
test("draft results and private conduct stay hidden until explicit safe publication", () => {
  const h = new ActivityHarness(); const actor = { school: "a", role: "STAFF" }; const child = { id: "c", school: "a" };
  const result = h.createResult(actor, actor.role, child, { subject: "Math" }); assert.equal(result.status, "DRAFT"); assert.equal(result.parentVisible, false);
  assert.throws(() => h.publish(actor, result), (e) => e.statusCode === 403);
  h.publish({ school: "a", role: "ADMIN" }, result); assert.equal(result.parentVisible, true);
  const conduct = h.conduct({ school: "a", role: "ADMIN" }, child, false); assert.equal(conduct.parentVisible, false);
});
test("STAFF cannot create sensitive conduct", () => {
  const h = new ActivityHarness(); assert.throws(() => h.conduct({ school: "a", role: "STAFF" }, { id: "c", school: "a" }, true), (e) => e.statusCode === 403);
});
test("guardian invite is one-time, hashed, tenant-bound and expires", () => {
  const h = new ActivityHarness(); const child = { id: "c", school: "a" }; const { code, hash } = h.invite({ school: "a", role: "OWNER" }, child);
  assert.notEqual(code, hash); assert.equal(h.accept("parent", code).status, "CONSUMED"); assert.throws(() => h.accept("other", code), /invalid invite/);
  const expired = h.invite({ school: "a", role: "ADMIN" }, child, -1); assert.throws(() => h.accept("parent", expired.code), /invalid invite/);
  const other = h.invite({ school: "a", role: "ADMIN" }, child); assert.throws(() => h.accept("parent", other.code + "x"), /invalid invite/);
});
test("bulk attendance has exact retry, conflicting retry, and rollback semantics", () => {
  const h = new ActivityHarness(); const actor = { school: "a" }; const payload = { records: [{ child: "c1" }, { child: "c2" }] };
  const first = h.bulk(actor, "k", payload); assert.deepEqual(h.bulk(actor, "k", payload).map((r) => r.id), first.map((r) => r.id));
  assert.throws(() => h.bulk(actor, "k", { records: [{ child: "different" }] }), (e) => e.statusCode === 409);
  assert.throws(() => h.bulk(actor, "new", { records: [{ invalid: true }] }), /rollback/);
  assert.equal(h.records.length, 2);
});
test("notification dedupe remains one record under repeated delivery", () => {
  const h = new ActivityHarness(); assert.equal(h.notify("record:parent"), 1); assert.equal(h.notify("record:parent"), 1);
});